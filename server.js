import "dotenv/config";
import express from "express";
import helmet from "helmet";

const app = express();

app.use(helmet());

app.use(
  express.json({
    limit: "1mb",
  })
);


// ======================================================
// Environment Variables
// ======================================================

const PORT = process.env.PORT || 3000;

const CALLYZER_API_KEY =
  process.env.CALLYZER_API_KEY;

const CALLYZER_BASE_URL =
  process.env.CALLYZER_BASE_URL;

const NEODOVE_WEBHOOK_SECRET =
  process.env.NEODOVE_WEBHOOK_SECRET;

const CALLYZER_WEBHOOK_SECRET =
  process.env.CALLYZER_WEBHOOK_SECRET;


// ======================================================
// Existing Callyzer Sandbox Custom Fields
// ======================================================

const CALLYZER_FIELDS = {
  NEODOVE_LEAD_ID:
    process.env.CALLYZER_FIELD_NEODOVE_LEAD_ID ||
    "InputBox1788251139587",

  CAMPAIGN_NAME:
    process.env.CALLYZER_FIELD_CAMPAIGN_NAME ||
    "InputBox1788251139595",

  LEAD_STATUS:
    process.env.CALLYZER_FIELD_LEAD_STATUS ||
    "InputBox1788251139603",

  AGENT_NAME:
    process.env.CALLYZER_FIELD_AGENT_NAME ||
    "InputBox1788251139614",

  AGENT_NUMBER:
    process.env.CALLYZER_FIELD_AGENT_NUMBER ||
    "InputBox1788251139623",
};


// ======================================================
// Startup Checks
// ======================================================

const requiredEnvironmentVariables = [
  "CALLYZER_API_KEY",
  "CALLYZER_BASE_URL",
  "NEODOVE_WEBHOOK_SECRET",
  "CALLYZER_WEBHOOK_SECRET",
];

for (const variable of requiredEnvironmentVariables) {
  if (!process.env[variable]) {
    console.error(
      `Missing environment variable: ${variable}`
    );
  }
}


// ======================================================
// Helpers
// ======================================================

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}


// ======================================================
// Indian Number Formatter
//
// 9876543210
// → 91-9876543210
//
// 919876543210
// → 91-9876543210
//
// 09876543210
// → 91-9876543210
// ======================================================

function formatIndianPhone(phone) {
  if (!phone) {
    return null;
  }

  let number =
    String(phone).replace(/\D/g, "");

  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number = number.slice(1);
  }

  if (number.length === 10) {
    return `91-${number}`;
  }

  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    return `91-${number.slice(2)}`;
  }

  return null;
}


// ======================================================
// Extract local 10-digit number
// ======================================================

function getLocalNumber(phone) {
  const formatted =
    formatIndianPhone(phone);

  if (!formatted) {
    return null;
  }

  return formatted.split("-")[1];
}


// ======================================================
// Parse API Response Safely
// ======================================================

async function readApiResponse(response) {
  const text =
    await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw_response: text,
    };
  }
}


// ======================================================
// Detect Duplicate Lead Response
// ======================================================

function isAlreadyExistingLead(data) {
  const text =
    JSON.stringify(data)
      .toLowerCase();

  return (
    text.includes("already exists") ||
    text.includes("already exist")
  );
}


// ======================================================
// Callyzer POST Helper
//
// Includes handling for Callyzer rate limiting.
// ======================================================

async function postToCallyzer(
  endpoint,
  payload,
  retries = 1
) {
  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    const response =
      await fetch(
        `${CALLYZER_BASE_URL}${endpoint}`,
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
            JSON.stringify(payload),
        }
      );

    const data =
      await readApiResponse(response);

    if (
      response.status === 429 &&
      attempt < retries
    ) {
      console.log(
        "Callyzer rate limit reached. Retrying in 2.2 seconds..."
      );

      await sleep(2200);

      continue;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  }

  return {
    ok: false,
    status: 500,
    data: {
      message:
        "Unable to call Callyzer API",
    },
  };
}


// ======================================================
// Automatically Create Callyzer Lead From Call
//
// Used when an Excel lead exists ONLY in NeoDove.
//
// Example:
//
// Shaon calls 9733182281
//
// Middleware creates:
//
// Name: 9733182281
// Phone: 91-9733182281
// Assigned: Shaon
//
// Existing calls are mapped automatically.
// ======================================================

async function createLeadFromCall({
  clientNumber,
  employeeNumber,
}) {
  const formattedClient =
    formatIndianPhone(clientNumber);

  const formattedEmployee =
    formatIndianPhone(employeeNumber);

  const localClientNumber =
    getLocalNumber(clientNumber);

  if (
    !formattedClient ||
    !formattedEmployee ||
    !localClientNumber
  ) {
    return {
      success: false,
      status: "invalid_number",
    };
  }

  const payload = {
    // Callyzer requires a lead name.
    // Real customer name is not needed.
    first_name:
      localClientNumber,

    contact_numbers: [
      formattedClient,
    ],

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        formattedEmployee,
      ],
    },

    // Critical:
    // Attach calls that happened before
    // the Callyzer lead was created.
    is_map_existing_call_logs:
      true,
  };


  console.log(
    "Auto-creating Callyzer lead:",
    {
      client:
        formattedClient,

      employee:
        formattedEmployee,
    }
  );


  const result =
    await postToCallyzer(
      "/lead/save",
      payload,
      1
    );


  if (result.ok) {
    return {
      success: true,
      status: "created",
      data: result.data,
    };
  }


  // Lead already exists.
  // This is okay.
  if (
    isAlreadyExistingLead(
      result.data
    )
  ) {
    return {
      success: true,
      status:
        "already_exists",

      data:
        result.data,
    };
  }


  return {
    success: false,

    status:
      "failed",

    httpStatus:
      result.status,

    data:
      result.data,
  };
}


// ======================================================
// Health Check
// ======================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,

    message:
      "NeoDove → Callyzer middleware is running",
  });
});


// ======================================================
// NeoDove → Callyzer Lead Webhook
//
// This handles normal/manual NeoDove leads.
//
// NeoDove sends:
// name
// mobile
// agent_number
// etc.
//
// Middleware creates the lead in Callyzer.
// ======================================================

app.post(
  "/neodove/lead",

  async (req, res) => {
    try {

      // ================================================
      // Verify NeoDove Secret
      // ================================================

      const incomingSecret =
        req.get(
          "x-webhook-secret"
        );

      if (
        !NEODOVE_WEBHOOK_SECRET ||
        incomingSecret !==
          NEODOVE_WEBHOOK_SECRET
      ) {
        console.warn(
          "Unauthorized NeoDove webhook"
        );

        return res
          .status(401)
          .json({
            success: false,

            message:
              "Unauthorized NeoDove webhook",
          });
      }


      // ================================================
      // Payload
      // ================================================

      const body =
        req.body;

      if (
        !body ||
        typeof body !==
          "object" ||
        Array.isArray(body)
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid NeoDove payload",
          });
      }


      // ================================================
      // NeoDove Fields
      // ================================================

      const leadId =
        body.lead_id;

      const leadName =
        body.name;

      const leadNumber =
        body.mobile;

      const leadEmail =
        body.email;


      const campaignName =
        body.campaign_name;


      const leadStatus =
        body.lead_status_name;


      const agentName =
        body.agent_name;

      const agentNumber =
        body.agent_number;


      // ================================================
      // Validation
      // ================================================

      if (
        !leadName ||
        !leadNumber
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Lead name and mobile are required",
          });
      }


      if (!agentNumber) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "NeoDove agent number is required",
          });
      }


      // ================================================
      // Phone Formatting
      // ================================================

      const formattedLead =
        formatIndianPhone(
          leadNumber
        );

      const formattedAgent =
        formatIndianPhone(
          agentNumber
        );


      if (
        !formattedLead ||
        !formattedAgent
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid Indian mobile number",
          });
      }


      // ================================================
      // Callyzer Custom Fields
      // ================================================

      const fields = {};


      if (
        leadId !== undefined &&
        leadId !== null
      ) {
        fields[
          CALLYZER_FIELDS
            .NEODOVE_LEAD_ID
        ] =
          String(leadId);
      }


      if (campaignName) {
        fields[
          CALLYZER_FIELDS
            .CAMPAIGN_NAME
        ] =
          String(
            campaignName
          );
      }


      if (leadStatus) {
        fields[
          CALLYZER_FIELDS
            .LEAD_STATUS
        ] =
          String(
            leadStatus
          );
      }


      if (agentName) {
        fields[
          CALLYZER_FIELDS
            .AGENT_NAME
        ] =
          String(agentName);
      }


      if (agentNumber) {
        fields[
          CALLYZER_FIELDS
            .AGENT_NUMBER
        ] =
          String(
            agentNumber
          );
      }


      // ================================================
      // Callyzer Lead
      // ================================================

      const callyzerPayload = {
        first_name:
          String(
            leadName
          ),

        contact_numbers: [
          formattedLead,
        ],

        assignment: {
          strategy:
            "Assign to All Selected",

          emp_numbers: [
            formattedAgent,
          ],
        },

        fields,

        is_map_existing_call_logs:
          true,
      };


      if (leadEmail) {
        callyzerPayload.email =
          String(
            leadEmail
          );
      }


      console.log(
        "NeoDove lead received:",
        {
          leadId,
          leadName,
          leadNumber,
          agentName,
          agentNumber,
        }
      );


      // ================================================
      // Send to Callyzer
      // ================================================

      const result =
        await postToCallyzer(
          "/lead/save",
          callyzerPayload,
          1
        );


      // ================================================
      // Success
      // ================================================

      if (result.ok) {
        console.log(
          "Lead successfully sent to Callyzer:",
          leadName
        );

        return res
          .status(200)
          .json({
            success: true,

            message:
              "Lead successfully sent to Callyzer",

            callyzer:
              result.data,
          });
      }


      // ================================================
      // Duplicate
      // ================================================

      if (
        isAlreadyExistingLead(
          result.data
        )
      ) {
        console.log(
          "Lead already exists in Callyzer:",
          leadNumber
        );

        return res
          .status(200)
          .json({
            success: true,

            message:
              "Lead already exists in Callyzer",

            callyzer:
              result.data,
          });
      }


      // ================================================
      // Error
      // ================================================

      console.error(
        "Callyzer rejected NeoDove lead:",
        result.data
      );


      return res
        .status(
          result.status
        )
        .json({
          success: false,

          message:
            "Callyzer rejected the lead",

          callyzer:
            result.data,
        });

    } catch (error) {

      console.error(
        "NeoDove webhook error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,

          message:
            "NeoDove middleware error",

          error:
            error.message,
        });
    }
  }
);


// ======================================================
// Callyzer Call Webhook
//
// This is the important Excel-lead part.
//
// Callyzer detects an outgoing phone call.
//
// Middleware receives:
//
// employee number
// client number
// duration
// recording URL
//
// Then automatically creates a Callyzer lead
// using the phone number.
//
// is_map_existing_call_logs = true
// attaches the call to the new lead.
// ======================================================

app.post(
  "/callyzer/call-webhook",

  async (req, res) => {
    try {

      // ================================================
      // Verify Callyzer Signature
      // ================================================

      const signature =
        req.get(
          "x-callyzer-signature"
        );


      if (
        !CALLYZER_WEBHOOK_SECRET ||
        signature !==
          CALLYZER_WEBHOOK_SECRET
      ) {
        console.warn(
          "Unauthorized Callyzer webhook"
        );


        return res
          .status(401)
          .json({
            success: false,

            message:
              "Unauthorized Callyzer webhook",
          });
      }


      // ================================================
      // Validate Payload
      // ================================================

      const payload =
        req.body;


      if (
        !Array.isArray(
          payload
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid Callyzer webhook payload",
          });
      }


      const processedNumbers =
        new Set();


      const results = [];


      let callyzerApiCalls = 0;


      // ================================================
      // Employees
      // ================================================

      for (
        const employee
        of payload
      ) {

        const employeeName =
          employee.emp_name;


        const employeeNumber =
          employee.emp_number;


        const callLogs =
          Array.isArray(
            employee.call_logs
          )
            ? employee.call_logs
            : [];


        // ==============================================
        // Calls
        // ==============================================

        for (
          const call
          of callLogs
        ) {

          const clientNumber =
            call.client_number;


          // ============================================
          // Log Call
          // ============================================

          console.log(
            "======================================"
          );


          console.log(
            "CALLYZER REAL CALL"
          );


          console.log({
            callId:
              call.id,

            employeeName,

            employeeNumber,

            clientNumber,

            callType:
              call.call_type,

            duration:
              call.duration,

            callDate:
              call.call_date,

            callTime:
              call.call_time,

            callMethod:
              call.call_method,

            callMode:
              call.call_mode,

            recordingUrl:
              call.call_recording_url ||
              null,
          });


          console.log(
            "======================================"
          );


          // ============================================
          // We only auto-create leads
          // from OUTGOING calls.
          //
          // This prevents spam/random incoming callers
          // from becoming leads.
          // ============================================

          if (
            String(
              call.call_type ||
              ""
            )
              .toLowerCase()
              .trim() !==
            "outgoing"
          ) {
            continue;
          }


          // ============================================
          // Validate Numbers
          //
          // This also prevents Callyzer's SAMPLE
          // Test & Save payload from creating fake leads.
          // Their sample numbers contain xxxx.
          // ============================================

          const formattedClient =
            formatIndianPhone(
              clientNumber
            );


          const formattedEmployee =
            formatIndianPhone(
              employeeNumber
            );


          if (
            !formattedClient ||
            !formattedEmployee
          ) {
            console.log(
              "Skipping invalid/test call numbers:",
              {
                clientNumber,
                employeeNumber,
              }
            );

            continue;
          }


          // ============================================
          // Don't process same number twice
          // in one webhook batch.
          // ============================================

          const key =
            `${formattedEmployee}:${formattedClient}`;


          if (
            processedNumbers.has(
              key
            )
          ) {
            continue;
          }


          processedNumbers.add(
            key
          );


          // ============================================
          // Respect Callyzer API rate limit
          // ============================================

          if (
            callyzerApiCalls >
            0
          ) {
            await sleep(2100);
          }


          callyzerApiCalls++;


          // ============================================
          // Create Callyzer Lead
          // ============================================

          const leadResult =
            await createLeadFromCall({
              clientNumber,
              employeeNumber,
            });


          results.push({
            clientNumber:
              formattedClient,

            employeeName,

            employeeNumber:
              formattedEmployee,

            callId:
              call.id,

            duration:
              call.duration,

            callType:
              call.call_type,

            recordingUrl:
              call.call_recording_url ||
              null,

            lead:
              leadResult,
          });


          // ============================================
          // Result Logs
          // ============================================

          if (
            leadResult.status ===
            "created"
          ) {
            console.log(
              `✅ Lead automatically created: ${formattedClient}`
            );
          }


          else if (
            leadResult.status ===
            "already_exists"
          ) {
            console.log(
              `ℹ️ Lead already exists: ${formattedClient}`
            );
          }


          else {
            console.error(
              `❌ Could not create lead: ${formattedClient}`,
              leadResult
            );
          }
        }
      }


      // ================================================
      // Webhook Success
      // ================================================

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Callyzer call webhook processed",

          leads_processed:
            results.length,

          results,
        });

    } catch (error) {

      console.error(
        "Callyzer webhook error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,

          message:
            "Callyzer webhook processing failed",

          error:
            error.message,
        });
    }
  }
);


// ======================================================
// 404
// ======================================================

app.use(
  (req, res) => {

    return res
      .status(404)
      .json({
        success: false,

        message:
          "Route not found",
      });
  }
);


// ======================================================
// Start Server
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
      "======================================"
    );
  }
);