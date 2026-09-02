import "dotenv/config";
import express from "express";
import helmet from "helmet";

// ======================================================
// APP
// ======================================================

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// ======================================================
// ENVIRONMENT
// ======================================================

const PORT = process.env.PORT || 3000;

const CALLYZER_API_KEY =
  process.env.CALLYZER_API_KEY;

const CALLYZER_BASE_URL =
  process.env.CALLYZER_BASE_URL;

const NEODOVE_WEBHOOK_SECRET =
  process.env.NEODOVE_WEBHOOK_SECRET;


// ======================================================
// VALIDATE ENV
// ======================================================

if (!CALLYZER_API_KEY) {
  console.warn(
    "⚠️ CALLYZER_API_KEY is missing"
  );
}

if (!CALLYZER_BASE_URL) {
  console.warn(
    "⚠️ CALLYZER_BASE_URL is missing"
  );
}

if (!NEODOVE_WEBHOOK_SECRET) {
  console.warn(
    "⚠️ NEODOVE_WEBHOOK_SECRET is missing"
  );
}


// ======================================================
// SLEEP
// ======================================================

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}


// ======================================================
// PHONE FORMATTER
// ======================================================

function formatIndianPhone(phone) {
  if (!phone) return null;

  let number =
    String(phone).replace(/\D/g, "");

  // Example:
  // 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number = number.slice(1);
  }

  // Example:
  // 919876543210
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    number = number.slice(2);
  }

  // Final expected Indian mobile:
  // 9876543210
  if (number.length !== 10) {
    return null;
  }

  return `91-${number}`;
}


// ======================================================
// READ API RESPONSE SAFELY
// ======================================================

async function readApiResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw_response: text,
    };
  }
}


// ======================================================
// CALLYZER QUEUE
//
// Callyzer API currently allows one request
// every ~2 seconds.
// ======================================================

let callyzerQueue =
  Promise.resolve();

let lastCallyzerRequestAt = 0;


async function respectCallyzerRateLimit() {
  // Use slightly more than 2 seconds
  const minimumGap = 2200;

  const now = Date.now();

  const elapsed =
    now - lastCallyzerRequestAt;

  if (elapsed < minimumGap) {
    await sleep(
      minimumGap - elapsed
    );
  }

  lastCallyzerRequestAt =
    Date.now();
}


function queueCallyzerJob(job) {
  const result =
    callyzerQueue.then(
      async () => {

        await respectCallyzerRateLimit();

        return job();
      }
    );

  // Keep queue alive even if one request fails
  callyzerQueue =
    result.catch((error) => {
      console.error(
        "Callyzer queue job failed:",
        error.message
      );
    });

  return result;
}


// ======================================================
// CALLYZER CREATE / UPDATE LEAD
// ======================================================

async function upsertCallyzerLead({
  name,
  mobile,
  agentNumber,
}) {

  const client =
    formatIndianPhone(mobile);

  const employee =
    formatIndianPhone(agentNumber);


  // ----------------------------------------------
  // Validate client
  // ----------------------------------------------

  if (!client) {
    return {
      success: false,
      status:
        "invalid_client_number",
      mobile,
    };
  }


  // ----------------------------------------------
  // Validate employee
  // ----------------------------------------------

  if (!employee) {
    return {
      success: false,
      status:
        "invalid_employee_number",
      agentNumber,
    };
  }


  const localNumber =
    client.split("-")[1];


  // ----------------------------------------------
  // Lead name
  // ----------------------------------------------

  let finalName =
    String(name || "").trim();


  // Callyzer first_name needs useful value.
  if (finalName.length < 3) {
    finalName = localNumber;
  }


  // ----------------------------------------------
  // Callyzer payload
  // ----------------------------------------------

  const payload = {

    first_name:
      finalName,


    contact_numbers: [
      client,
    ],


    // Current NeoDove agent
    assignment: {

      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employee,
      ],
    },


    // If this number already exists in Callyzer:
    //
    // DON'T overwrite name/details
    // DO overwrite employee assignment
    existing_lead: {

      lead_details:
        "ignore",

      assignee:
        "overwrite",

      lead_tags:
        "ignore",
    },


    // Map previously synced call logs
    is_map_existing_call_logs:
      true,
  };


  console.log(
    "======================================"
  );

  console.log(
    "CALLYZER UPSERT"
  );

  console.log({
    name: finalName,
    client,
    employee,
  });

  console.log(
    "======================================"
  );


  // ====================================================
  // API REQUEST + RETRY
  // ====================================================

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {

    try {

      const response =
        await fetch(
          `${CALLYZER_BASE_URL}/lead/save`,
          {
            method: "POST",

            headers: {

              Authorization:
                `Bearer ${CALLYZER_API_KEY}`,

              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        );


      const data =
        await readApiResponse(
          response
        );


      // ------------------------------------------
      // SUCCESS
      // ------------------------------------------

      if (response.ok) {

        return {
          success: true,

          status:
            "created_or_updated",

          httpStatus:
            response.status,

          data,
        };
      }


      // ------------------------------------------
      // RATE LIMIT
      // ------------------------------------------

      if (
        response.status === 429 &&
        attempt < 3
      ) {

        console.log(
          `⚠️ Callyzer rate limit. Retry ${attempt}/2`
        );

        await sleep(2500);

        continue;
      }


      // ------------------------------------------
      // API ERROR
      // ------------------------------------------

      return {
        success: false,

        status:
          "callyzer_api_error",

        httpStatus:
          response.status,

        data,
      };


    } catch (error) {

      console.error(
        "Callyzer request error:",
        error
      );


      if (attempt < 3) {

        await sleep(2500);

        continue;
      }


      return {
        success: false,

        status:
          "network_error",

        error:
          error.message,
      };
    }
  }
}


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {

  res.json({

    success: true,

    message:
      "NeoDove → Callyzer middleware is running",

    environment:
      CALLYZER_BASE_URL?.includes(
        "sandbox"
      )
        ? "sandbox"
        : "production",
  });
});


// ======================================================
// NEO DOVE EVENT PARSER
// ======================================================

function parseNeoDoveEvent(body) {

  const leadName =

    body.name ||

    body.lead_name ||

    body.contact_name ||

    null;


  const mobile =

    body.mobile ||

    body.phone ||

    body.phone_number ||

    body.contact_number ||

    null;


  const agentName =

    body.agent_name ||

    body.agentName ||

    body.assigned_agent_name ||

    body.assignee_name ||

    body.agent?.name ||

    null;


  const agentNumber =

    body.agent_number ||

    body.agentNumber ||

    body.assigned_agent_number ||

    body.assignee_number ||

    body.agent?.number ||

    body.agent?.phone ||

    null;


  const eventName =

    body.event_name ||

    body.event ||

    body.trigger ||

    body.workflow_event ||

    null;


  return {

    leadName,

    mobile,

    agentName,

    agentNumber,

    eventName,
  };
}


// ======================================================
// MAIN NEO DOVE ROUTE
//
// USE THIS URL FOR:
//
// 1. Lead Created
// 2. Call Connected
// 3. Call Not Connected
//
// https://YOUR-RENDER.onrender.com/neodove/call-sync
// ======================================================

app.post(
  "/neodove/call-sync",

  async (req, res) => {

    try {

      // --------------------------------------------
      // AUTHENTICATION
      // --------------------------------------------

      const secret =
        req.get(
          "x-webhook-secret"
        );


      if (
        !NEODOVE_WEBHOOK_SECRET ||
        secret !==
          NEODOVE_WEBHOOK_SECRET
      ) {

        console.log(
          "❌ Invalid NeoDove webhook secret"
        );


        return res
          .status(401)
          .json({

            success: false,

            message:
              "Unauthorized NeoDove webhook",
          });
      }


      // --------------------------------------------
      // LOG RAW PAYLOAD
      // --------------------------------------------

      console.log(
        "======================================"
      );

      console.log(
        "NEODOVE EVENT RECEIVED"
      );

      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      console.log(
        "======================================"
      );


      // --------------------------------------------
      // PARSE DATA
      // --------------------------------------------

      const {
        leadName,
        mobile,
        agentName,
        agentNumber,
        eventName,
      } =
        parseNeoDoveEvent(
          req.body
        );


      console.log(
        "PARSED NEODOVE EVENT"
      );

      console.log({

        eventName,

        leadName,

        mobile,

        agentName,

        agentNumber,
      });


      // --------------------------------------------
      // MOBILE REQUIRED
      // --------------------------------------------

      if (!mobile) {

        console.log(
          "⚠️ Mobile number missing"
        );


        return res
          .status(200)
          .json({

            success: true,

            status:
              "ignored_missing_mobile",

            message:
              "NeoDove event received but client mobile is missing",
          });
      }


      // --------------------------------------------
      // AGENT REQUIRED
      // --------------------------------------------

      if (!agentNumber) {

        console.log(
          "⚠️ Agent number missing"
        );


        return res
          .status(200)
          .json({

            success: true,

            status:
              "ignored_missing_agent",

            message:
              "NeoDove event received but assigned agent number is missing",

            lead: {

              name:
                leadName,

              mobile,

              agent_name:
                agentName,
            },
          });
      }


      // --------------------------------------------
      // QUEUE CALLYZER
      // --------------------------------------------

      const callyzerResult =
        await queueCallyzerJob(

          () =>
            upsertCallyzerLead({

              name:
                leadName,

              mobile,

              agentNumber,
            })
        );


      // --------------------------------------------
      // LOG RESULT
      // --------------------------------------------

      console.log(
        "======================================"
      );

      console.log(
        "CALLYZER RESULT"
      );

      console.log(
        JSON.stringify(
          callyzerResult,
          null,
          2
        )
      );

      console.log(
        "======================================"
      );


      // --------------------------------------------
      // RESPONSE TO NEODOVE
      // --------------------------------------------

      return res
        .status(200)
        .json({

          success: true,

          message:
            "NeoDove event processed",

          event:
            eventName,

          neodove: {

            name:
              leadName,

            mobile,

            agent_name:
              agentName,

            agent_number:
              agentNumber,
          },

          callyzer:
            callyzerResult,
        });


    } catch (error) {

      console.error(
        "❌ NeoDove processing error:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          message:
            "NeoDove event processing failed",

          error:
            error.message,
        });
    }
  }
);


// ======================================================
// OPTIONAL OLD ROUTE
//
// Keeping this means if any old NeoDove configuration
// still points to /neodove/lead, it will not 404.
// ======================================================

app.post(
  "/neodove/lead",

  async (req, res) => {

    try {

      const secret =
        req.get(
          "x-webhook-secret"
        );


      if (
        !NEODOVE_WEBHOOK_SECRET ||
        secret !==
          NEODOVE_WEBHOOK_SECRET
      ) {

        return res
          .status(401)
          .json({

            success: false,

            message:
              "Unauthorized NeoDove webhook",
          });
      }


      const {
        leadName,
        mobile,
        agentName,
        agentNumber,
        eventName,
      } =
        parseNeoDoveEvent(
          req.body
        );


      if (!mobile) {

        return res
          .status(200)
          .json({

            success: true,

            status:
              "ignored_missing_mobile",
          });
      }


      if (!agentNumber) {

        return res
          .status(200)
          .json({

            success: true,

            status:
              "ignored_missing_agent",
          });
      }


      const callyzerResult =
        await queueCallyzerJob(

          () =>
            upsertCallyzerLead({

              name:
                leadName,

              mobile,

              agentNumber,
            })
        );


      return res.json({

        success: true,

        message:
          "NeoDove lead processed",

        event:
          eventName,

        lead: {

          name:
            leadName,

          mobile,

          agent_name:
            agentName,

          agent_number:
            agentNumber,
        },

        callyzer:
          callyzerResult,
      });


    } catch (error) {

      console.error(
        "Old NeoDove route error:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          message:
            "NeoDove lead processing failed",

          error:
            error.message,
        });
    }
  }
);


// ======================================================
// 404
//
// MUST ALWAYS BE LAST ROUTE
// ======================================================

app.use((req, res) => {

  res
    .status(404)
    .json({

      success: false,

      message:
        "Route not found",
    });
});


// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",

  () => {

    console.log(
      "======================================"
    );

    console.log(
      "NeoDove → Callyzer middleware running"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Callyzer environment: ${
        CALLYZER_BASE_URL?.includes(
          "sandbox"
        )
          ? "SANDBOX"
          : "PRODUCTION"
      }`
    );

    console.log(
      "Main NeoDove endpoint:"
    );

    console.log(
      "/neodove/call-sync"
    );

    console.log(
      "======================================"
    );
  }
);