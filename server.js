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
// CALLYZER CUSTOM FIELD IDS
// ======================================================

const CALLYZER_FIELDS = {
  email: "InputBox1787666201411",
  address: "InputBox1787666201414",
  city: "InputBox1787666201418",
  state: "InputBox1787666201420",
  zipcode: "InputBox1787666201423",
  description: "InputBox1787666201429",

  neodoveLeadId:
    "InputBox1788251139587",

  neodoveCampaignName:
    "InputBox1788251139595",

  neodoveLeadStatus:
    "InputBox1788251139603",

  neodoveAgentName:
    "InputBox1788251139614",

  neodoveAgentNumber:
    "InputBox1788251139623",
};

// ======================================================
// ENV CHECK
// ======================================================

if (!CALLYZER_API_KEY) {
  console.warn(
    "⚠️ CALLYZER_API_KEY missing"
  );
}

if (!CALLYZER_BASE_URL) {
  console.warn(
    "⚠️ CALLYZER_BASE_URL missing"
  );
}

if (!NEODOVE_WEBHOOK_SECRET) {
  console.warn(
    "⚠️ NEODOVE_WEBHOOK_SECRET missing"
  );
}

// ======================================================
// HELPERS
// ======================================================

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function cleanValue(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function normalizePropertyName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// ======================================================
// GET NEODOVE CUSTOM PROPERTY
// ======================================================

function getCustomProperty(
  body,
  possibleNames = []
) {
  const normalizedNames =
    possibleNames.map(
      normalizePropertyName
    );

  // ----------------------------------------------------
  // contact_custom_properties object
  // ----------------------------------------------------

  if (
    body.contact_custom_properties &&
    typeof body.contact_custom_properties ===
      "object" &&
    !Array.isArray(
      body.contact_custom_properties
    )
  ) {
    for (
      const [key, value]
      of Object.entries(
        body.contact_custom_properties
      )
    ) {
      if (
        normalizedNames.includes(
          normalizePropertyName(key)
        )
      ) {
        return cleanValue(value);
      }
    }
  }

  // ----------------------------------------------------
  // other_properties object
  // ----------------------------------------------------

  if (
    body.other_properties &&
    typeof body.other_properties ===
      "object" &&
    !Array.isArray(
      body.other_properties
    )
  ) {
    for (
      const [key, value]
      of Object.entries(
        body.other_properties
      )
    ) {
      if (
        normalizedNames.includes(
          normalizePropertyName(key)
        )
      ) {
        return cleanValue(value);
      }
    }
  }

  // ----------------------------------------------------
  // other_properties array
  // ----------------------------------------------------

  if (
    Array.isArray(
      body.other_properties
    )
  ) {
    for (
      const group
      of body.other_properties
    ) {
      const properties =
        Array.isArray(
          group?.properties
        )
          ? group.properties
          : [];

      for (
        const property
        of properties
      ) {
        const propertyName =
          normalizePropertyName(
            property?.name
          );

        if (
          normalizedNames.includes(
            propertyName
          )
        ) {
          return cleanValue(
            property?.value
          );
        }
      }
    }
  }

  // ----------------------------------------------------
  // customer_detail_form_response
  // ----------------------------------------------------

  if (
    body.customer_detail_form_response
  ) {
    if (
      Array.isArray(
        body.customer_detail_form_response
      )
    ) {
      for (
        const property
        of body.customer_detail_form_response
      ) {
        const propertyName =
          normalizePropertyName(
            property?.name ||
            property?.label ||
            property?.key
          );

        if (
          normalizedNames.includes(
            propertyName
          )
        ) {
          return cleanValue(
            property?.value
          );
        }
      }
    } else if (
      typeof body.customer_detail_form_response ===
      "object"
    ) {
      for (
        const [key, value]
        of Object.entries(
          body.customer_detail_form_response
        )
      ) {
        if (
          normalizedNames.includes(
            normalizePropertyName(key)
          )
        ) {
          return cleanValue(value);
        }
      }
    }
  }

  return null;
}

// ======================================================
// PHONE FORMATTER
// ======================================================

function formatIndianPhone(phone) {
  if (!phone) {
    return null;
  }

  let number =
    String(phone)
      .replace(/\D/g, "");

  // 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number =
      number.slice(1);
  }

  // 919876543210
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    number =
      number.slice(2);
  }

  if (number.length !== 10) {
    return null;
  }

  return `91-${number}`;
}

// ======================================================
// READ API RESPONSE
// ======================================================

async function readApiResponse(
  response
) {
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
// PARSE NEODOVE EVENT
// ======================================================

function parseNeoDoveEvent(body) {
  // ----------------------------------------------------
  // NAME
  // ----------------------------------------------------

  const leadName =
    cleanValue(body.name) ||
    cleanValue(body.lead_name) ||
    cleanValue(body.contact_name);

  // ----------------------------------------------------
  // MOBILE
  // ----------------------------------------------------

  const mobile =
    cleanValue(body.mobile) ||
    cleanValue(body.phone) ||
    cleanValue(body.phone_number) ||
    cleanValue(
      body.contact_number
    );

  // ----------------------------------------------------
  // CURRENT NEODOVE AGENT
  // ----------------------------------------------------

  const agentName =
    cleanValue(
      body.agent_name
    ) ||
    cleanValue(
      body.agentName
    ) ||
    cleanValue(
      body.assigned_agent_name
    ) ||
    cleanValue(
      body.assignee_name
    ) ||
    cleanValue(
      body.agent?.name
    );

  const agentNumber =
    cleanValue(
      body.agent_number
    ) ||
    cleanValue(
      body.agentNumber
    ) ||
    cleanValue(
      body.assigned_agent_number
    ) ||
    cleanValue(
      body.assignee_number
    ) ||
    cleanValue(
      body.agent?.number
    ) ||
    cleanValue(
      body.agent?.phone
    );

  // ----------------------------------------------------
  // EVENT NAME
  // ----------------------------------------------------

  const eventName =
    cleanValue(
      body.event_name
    ) ||
    cleanValue(body.event) ||
    cleanValue(body.trigger) ||
    cleanValue(
      body.workflow_event
    );

  // ----------------------------------------------------
  // EMAIL
  // ----------------------------------------------------

  const email =
    cleanValue(body.email) ||
    getCustomProperty(
      body,
      [
        "Email",
        "Email Address",
      ]
    );

  // ----------------------------------------------------
  // ADDRESS
  // ----------------------------------------------------

  const address =
    cleanValue(
      body.address_1
    ) ||
    cleanValue(
      body.address1
    ) ||
    cleanValue(
      body.address
    ) ||
    getCustomProperty(
      body,
      [
        "Address",
        "Address 1",
        "Address1",
      ]
    );

  // ----------------------------------------------------
  // CITY
  // ----------------------------------------------------

  const city =
    cleanValue(body.city) ||
    getCustomProperty(
      body,
      ["City"]
    );

  // ----------------------------------------------------
  // STATE
  // ----------------------------------------------------

  const state =
    cleanValue(body.state) ||
    getCustomProperty(
      body,
      ["State"]
    );

  // ----------------------------------------------------
  // ZIPCODE
  // ----------------------------------------------------

  const zipcode =
    cleanValue(
      body.zipcode
    ) ||
    cleanValue(
      body.zip_code
    ) ||
    cleanValue(
      body.pincode
    ) ||
    cleanValue(
      body.pin_code
    ) ||
    getCustomProperty(
      body,
      [
        "Zipcode",
        "Zip Code",
        "Pincode",
        "Pin Code",
        "Postal Code",
      ]
    );

  // ----------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------

  const description =
    cleanValue(
      body.description
    ) ||
    cleanValue(
      body.dispose_remark
    ) ||
    cleanValue(
      body.dispose_remarks
    ) ||
    getCustomProperty(
      body,
      ["Description"]
    );

  // ----------------------------------------------------
  // NEODOVE METADATA
  // ----------------------------------------------------

  const leadId =
    cleanValue(
      body.lead_id
    );

  const campaignName =
    cleanValue(
      body.campaign_name
    );

  const leadStatus =
    cleanValue(
      body.lead_status_name
    ) ||
    cleanValue(
      body.lead_stage_name
    ) ||
    cleanValue(
      body.lead_status
    );

  return {
    leadName,
    mobile,
    agentName,
    agentNumber,
    eventName,

    email,
    address,
    city,
    state,
    zipcode,
    description,

    leadId,
    campaignName,
    leadStatus,
  };
}

// ======================================================
// BUILD CALLYZER OPTIONAL FIELDS
// ======================================================

function buildCallyzerFields(
  data
) {
  const fields = {};

  function addField(
    fieldId,
    value
  ) {
    const cleaned =
      cleanValue(value);

    if (!cleaned) {
      return;
    }

    fields[fieldId] =
      cleaned;
  }

  addField(
    CALLYZER_FIELDS.email,
    data.email
  );

  addField(
    CALLYZER_FIELDS.address,
    data.address
  );

  addField(
    CALLYZER_FIELDS.city,
    data.city
  );

  addField(
    CALLYZER_FIELDS.state,
    data.state
  );

  addField(
    CALLYZER_FIELDS.zipcode,
    data.zipcode
  );

  addField(
    CALLYZER_FIELDS.description,
    data.description
  );

  addField(
    CALLYZER_FIELDS.neodoveLeadId,
    data.leadId
  );

  addField(
    CALLYZER_FIELDS.neodoveCampaignName,
    data.campaignName
  );

  addField(
    CALLYZER_FIELDS.neodoveLeadStatus,
    data.leadStatus
  );

  addField(
    CALLYZER_FIELDS.neodoveAgentName,
    data.agentName
  );

  addField(
    CALLYZER_FIELDS.neodoveAgentNumber,
    data.agentNumber
  );

  return fields;
}

// ======================================================
// CALLYZER QUEUE
// ======================================================

let callyzerQueue =
  Promise.resolve();

let lastCallyzerRequestAt = 0;

async function respectCallyzerRateLimit() {
  // More than 2 seconds for safety
  const minimumGap = 2200;

  const now =
    Date.now();

  const elapsed =
    now -
    lastCallyzerRequestAt;

  if (
    elapsed <
    minimumGap
  ) {
    await sleep(
      minimumGap -
      elapsed
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

  callyzerQueue =
    result.catch(
      (error) => {
        console.error(
          "Callyzer queue error:",
          error.message
        );
      }
    );

  return result;
}

// ======================================================
// CREATE / UPDATE CALLYZER LEAD
// ======================================================

async function upsertCallyzerLead(
  data
) {
  const client =
    formatIndianPhone(
      data.mobile
    );

  const employee =
    formatIndianPhone(
      data.agentNumber
    );

  // ----------------------------------------------------
  // VALIDATE CLIENT
  // ----------------------------------------------------

  if (!client) {
    return {
      success: false,

      status:
        "invalid_client_number",

      mobile:
        data.mobile,
    };
  }

  // ----------------------------------------------------
  // VALIDATE AGENT
  // ----------------------------------------------------

  if (!employee) {
    return {
      success: false,

      status:
        "invalid_employee_number",

      agentNumber:
        data.agentNumber,
    };
  }

  const localNumber =
    client.split("-")[1];

  let finalName =
    cleanValue(
      data.leadName
    );

  if (
    !finalName ||
    finalName.length < 3
  ) {
    finalName =
      localNumber;
  }

  const fields =
    buildCallyzerFields(
      data
    );

  // ====================================================
  // CALLYZER PAYLOAD
  // ====================================================

  const payload = {
    first_name:
      finalName,

    contact_numbers: [
      client,
    ],

    // --------------------------------------------------
    // NEW LEAD:
    // Assign to the NeoDove agent.
    //
    // EXISTING LEAD:
    // Because assignee = ignore below,
    // the old owner remains unchanged.
    // --------------------------------------------------

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employee,
      ],
    },

    // --------------------------------------------------
    // EXISTING LEAD SETTINGS
    // --------------------------------------------------

    existing_lead: {
      // Update available lead details
      lead_details:
        "overwrite",

      // IMPORTANT:
      // Do NOT change current "Assign To"
      // if the lead already exists.
      assignee:
        "ignore",

      lead_tags:
        "ignore",
    },

    // --------------------------------------------------
    // MAP CALL LOGS
    // --------------------------------------------------

    is_map_existing_call_logs:
      true,
  };

  // ----------------------------------------------------
  // STANDARD EMAIL
  // ----------------------------------------------------

  const cleanEmail =
    cleanValue(
      data.email
    );

  if (cleanEmail) {
    payload.email =
      cleanEmail;
  }

  // ----------------------------------------------------
  // OPTIONAL CALLYZER FIELDS
  // ----------------------------------------------------

  if (
    Object.keys(fields)
      .length > 0
  ) {
    payload.fields =
      fields;
  }

  // ----------------------------------------------------
  // LOG
  // ----------------------------------------------------

  console.log(
    "======================================"
  );

  console.log(
    "CALLYZER UPSERT"
  );

  console.log({
    name:
      finalName,

    client,

    incomingAgent:
      employee,

    note:
      "Existing lead assignee will NOT be changed",

    availableFields:
      Object.keys(fields)
        .length,
  });

  console.log(
    "Callyzer fields:"
  );

  console.log(
    JSON.stringify(
      fields,
      null,
      2
    )
  );

  console.log(
    "======================================"
  );

  // ====================================================
  // CALLYZER API
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
            method:
              "POST",

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

      const responseData =
        await readApiResponse(
          response
        );

      // ------------------------------------------------
      // SUCCESS
      // ------------------------------------------------

      if (response.ok) {
        return {
          success: true,

          status:
            "created_or_updated",

          httpStatus:
            response.status,

          data:
            responseData,
        };
      }

      // ------------------------------------------------
      // RATE LIMIT
      // ------------------------------------------------

      if (
        response.status === 429 &&
        attempt < 3
      ) {
        console.log(
          `⚠️ Callyzer rate limit. Retrying...`
        );

        await sleep(2500);

        continue;
      }

      // ------------------------------------------------
      // API ERROR
      // ------------------------------------------------

      return {
        success: false,

        status:
          "callyzer_api_error",

        httpStatus:
          response.status,

        data:
          responseData,
      };
    } catch (error) {
      console.error(
        "Callyzer network error:",
        error
      );

      if (
        attempt < 3
      ) {
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
// PROCESS NEODOVE EVENT
// ======================================================

async function processNeoDoveEvent(
  req,
  res
) {
  try {
    // --------------------------------------------------
    // SECURITY
    // --------------------------------------------------

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
          success:
            false,

          message:
            "Unauthorized NeoDove webhook",
        });
    }

    // --------------------------------------------------
    // RAW EVENT
    // --------------------------------------------------

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

    // --------------------------------------------------
    // PARSE
    // --------------------------------------------------

    const data =
      parseNeoDoveEvent(
        req.body
      );

    console.log(
      "PARSED NEODOVE EVENT"
    );

    console.log(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    // --------------------------------------------------
    // MOBILE REQUIRED
    // --------------------------------------------------

    if (!data.mobile) {
      return res
        .status(200)
        .json({
          success:
            true,

          status:
            "ignored_missing_mobile",

          message:
            "NeoDove event received but mobile is missing",
        });
    }

    // --------------------------------------------------
    // AGENT REQUIRED
    // --------------------------------------------------

    if (
      !data.agentNumber
    ) {
      return res
        .status(200)
        .json({
          success:
            true,

          status:
            "ignored_missing_agent",

          message:
            "NeoDove event received but agent number is missing",

          lead: {
            name:
              data.leadName,

            mobile:
              data.mobile,

            agent_name:
              data.agentName,
          },
        });
    }

    // --------------------------------------------------
    // SEND TO CALLYZER QUEUE
    // --------------------------------------------------

    const callyzerResult =
      await queueCallyzerJob(
        () =>
          upsertCallyzerLead(
            data
          )
      );

    // --------------------------------------------------
    // RESULT
    // --------------------------------------------------

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

    return res
      .status(200)
      .json({
        success:
          true,

        message:
          "NeoDove event processed",

        event:
          data.eventName,

        neodove: {
          name:
            data.leadName,

          mobile:
            data.mobile,

          agent_name:
            data.agentName,

          agent_number:
            data.agentNumber,

          lead_id:
            data.leadId,

          campaign_name:
            data.campaignName,

          lead_status:
            data.leadStatus,
        },

        fields_sent:
          buildCallyzerFields(
            data
          ),

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
        success:
          false,

        message:
          "NeoDove event processing failed",

        error:
          error.message,
      });
  }
}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      success:
        true,

      message:
        "NeoDove → Callyzer middleware is running",

      environment:
        CALLYZER_BASE_URL?.includes(
          "sandbox"
        )
          ? "sandbox"
          : "production",
    });
  }
);

// ======================================================
// MAIN ROUTE
//
// NeoDove workflows:
//
// 1. Lead Created
// 2. Call Connected
// 3. Call Not Connected
//
// all point here.
// ======================================================

app.post(
  "/neodove/call-sync",
  processNeoDoveEvent
);

// ======================================================
// OLD ROUTE COMPATIBILITY
// ======================================================

app.post(
  "/neodove/lead",
  processNeoDoveEvent
);

// ======================================================
// 404
// MUST BE LAST
// ======================================================

app.use(
  (req, res) => {
    res
      .status(404)
      .json({
        success:
          false,

        message:
          "Route not found",
      });
  }
);

// ======================================================
// SERVER
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
      "NeoDove endpoint:"
    );

    console.log(
      "/neodove/call-sync"
    );

    console.log(
      "Existing lead assignment mode: IGNORE"
    );

    console.log(
      "======================================"
    );
  }
);