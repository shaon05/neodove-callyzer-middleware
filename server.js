import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";

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
  String(
    process.env.CALLYZER_BASE_URL || ""
  ).replace(/\/+$/, "");

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
// CONFIG
// ======================================================

const CALLYZER_MIN_GAP_MS = 2200;

const EVENT_DEDUPE_MS =
  10 * 60 * 1000;

const MAX_FAILED_JOBS_STORED = 50;

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
// BASIC HELPERS
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
// PHONE HELPERS
// ======================================================

function localIndianNumber(phone) {
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

  return number;
}

function formatIndianPhone(phone) {
  const number =
    localIndianNumber(phone);

  if (!number) {
    return null;
  }

  return `91-${number}`;
}

// ======================================================
// READ NEODOVE CUSTOM PROPERTY
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
  // contact_custom_properties
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
  // other_properties as object
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
  // other_properties as array
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
        const key =
          normalizePropertyName(
            property?.name
          );

        if (
          normalizedNames.includes(
            key
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
        const key =
          normalizePropertyName(
            property?.name ||
            property?.label ||
            property?.key
          );

        if (
          normalizedNames.includes(
            key
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
  // CLIENT PHONE
  // ----------------------------------------------------

  const mobile =
    cleanValue(body.mobile) ||
    cleanValue(body.phone) ||
    cleanValue(body.phone_number) ||
    cleanValue(body.contact_number);

  // ----------------------------------------------------
  // AGENT
  // ----------------------------------------------------

  const agentName =
    cleanValue(body.agent_name) ||
    cleanValue(body.agentName) ||
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
    cleanValue(body.agent_number) ||
    cleanValue(body.agentNumber) ||
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

  let eventName =
    cleanValue(body.event_name) ||
    cleanValue(body.event) ||
    cleanValue(body.trigger) ||
    cleanValue(body.workflow_event);

  if (!eventName) {
    if (
      body.call_connected === true
    ) {
      eventName =
        "CALL_CONNECTED";
    } else if (
      body.call_connected === false
    ) {
      eventName =
        "CALL_NOT_CONNECTED";
    } else {
      eventName =
        "LEAD_EVENT";
    }
  }

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
    cleanValue(body.address_1) ||
    cleanValue(body.address1) ||
    cleanValue(body.address) ||
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
      [
        "City",
      ]
    );

  // ----------------------------------------------------
  // STATE
  // ----------------------------------------------------

  const state =
    cleanValue(body.state) ||
    getCustomProperty(
      body,
      [
        "State",
      ]
    );

  // ----------------------------------------------------
  // ZIPCODE
  // ----------------------------------------------------

  const zipcode =
    cleanValue(body.zipcode) ||
    cleanValue(body.zip_code) ||
    cleanValue(body.pincode) ||
    cleanValue(body.pin_code) ||
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
    cleanValue(body.description) ||
    cleanValue(
      body.dispose_remark
    ) ||
    cleanValue(
      body.dispose_remarks
    ) ||
    getCustomProperty(
      body,
      [
        "Description",
      ]
    );

  // ----------------------------------------------------
  // NEODOVE DETAILS
  // ----------------------------------------------------

  const leadId =
    cleanValue(
      body.lead_id
    );

  const campaignName =
    cleanValue(
      body.campaign_name
    );

  // Example:
  //
  // lead_status_name = null
  // lead_stage_name = IN PROGRESS
  //
  // result:
  // IN PROGRESS
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
// BUILD OPTIONAL CALLYZER FIELDS
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

    // Missing / blank
    // = don't send field.
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
// CALLYZER RATE LIMIT
// ======================================================

let lastCallyzerRequestAt = 0;

async function waitForCallyzerSlot() {
  const elapsed =
    Date.now() -
    lastCallyzerRequestAt;

  if (
    elapsed <
    CALLYZER_MIN_GAP_MS
  ) {
    await sleep(
      CALLYZER_MIN_GAP_MS -
      elapsed
    );
  }

  lastCallyzerRequestAt =
    Date.now();
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
// CALLYZER POST
//
// Includes:
// - rate limiting
// - 429 retry
// - network retry
// ======================================================

async function callyzerPost(
  path,
  payload
) {
  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      await waitForCallyzerSlot();

      const response =
        await fetch(
          `${CALLYZER_BASE_URL}${path}`,
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

      const responseData =
        await readApiResponse(
          response
        );

      // ----------------------------------------------
      // SUCCESS
      // ----------------------------------------------

      if (response.ok) {
        return {
          success: true,

          httpStatus:
            response.status,

          data:
            responseData,
        };
      }

      // ----------------------------------------------
      // RATE LIMIT
      // ----------------------------------------------

      if (
        response.status === 429 &&
        attempt < 3
      ) {
        let waitMs = 2500;

        const retryAfter =
          Number(
            response.headers.get(
              "retry-after"
            )
          );

        if (
          Number.isFinite(
            retryAfter
          ) &&
          retryAfter > 0
        ) {
          waitMs =
            retryAfter * 1000;
        }

        console.log(
          `⚠️ Callyzer 429. Waiting ${waitMs}ms`
        );

        await sleep(waitMs);

        continue;
      }

      // ----------------------------------------------
      // NORMAL API ERROR
      // ----------------------------------------------

      return {
        success: false,

        httpStatus:
          response.status,

        data:
          responseData,
      };
    } catch (error) {
      console.error(
        "Callyzer network error:",
        error.message
      );

      if (
        attempt < 3
      ) {
        await sleep(2500);
        continue;
      }

      return {
        success: false,

        httpStatus: 0,

        data: {
          message:
            error.message,
        },
      };
    }
  }
}

// ======================================================
// CAPTURE / UPDATE CALLYZER LEAD
//
// IMPORTANT:
//
// We use /lead/capture.
//
// New number:
// → Creates lead.
//
// Existing number:
// → Updates using existing_lead rules.
//
// Therefore we don't need:
// /lead/get → /lead/save
//
// One API request per NeoDove event.
// ======================================================

async function syncLeadToCallyzer(
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

  if (!client) {
    throw new Error(
      `Invalid client number: ${data.mobile}`
    );
  }

  if (!employee) {
    throw new Error(
      `Invalid employee number: ${data.agentNumber}`
    );
  }

  const localNumber =
    localIndianNumber(
      data.mobile
    );

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
  // PAYLOAD
  // ====================================================

  const payload = {
    first_name:
      finalName,

    contact_numbers: [
      client,
    ],

    // --------------------------------------------------
    // NEW LEAD
    //
    // It gets assigned to the current
    // NeoDove agent.
    // --------------------------------------------------

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employee,
      ],
    },

    // --------------------------------------------------
    // EXISTING LEAD
    // --------------------------------------------------

    existing_lead: {
      // Update NeoDove fields:
      // status, email, description,
      // campaign, agent metadata, etc.
      lead_details:
        "overwrite",

      // VERY IMPORTANT:
      //
      // Existing Callyzer "Assign To"
      // stays unchanged.
      assignee:
        "ignore",

      lead_tags:
        "ignore",
    },

    // --------------------------------------------------
    // MAP CALLYZER CALL HISTORY
    // --------------------------------------------------

    is_map_existing_call_logs:
      true,
  };

  // ----------------------------------------------------
  // OPTIONAL DYNAMIC FIELDS
  // ----------------------------------------------------

  if (
    Object.keys(fields)
      .length > 0
  ) {
    payload.fields =
      fields;
  }

  console.log(
    "======================================"
  );

  console.log(
    "SYNCING LEAD TO CALLYZER"
  );

  console.log({
    name:
      finalName,

    client,

    incomingAgent:
      employee,

    event:
      data.eventName,

    neodoveStatus:
      data.leadStatus,

    fields:
      Object.keys(fields)
        .length,

    existingAssignee:
      "IGNORE",
  });

  console.log(
    "Fields:"
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

  const result =
    await callyzerPost(
      "/lead/capture",
      payload
    );

  if (!result.success) {
    throw new Error(
      `Callyzer API ${
        result.httpStatus
      }: ${JSON.stringify(
        result.data
      )}`
    );
  }

  // ----------------------------------------------------
  // RESPONSE DETAILS
  // ----------------------------------------------------

  const savedLead =
    Array.isArray(
      result.data?.result
        ?.savedLeads
    )
      ? result.data.result
          .savedLeads[0]
      : null;

  const isNewLead =
    savedLead
      ?.is_new_lead;

  const leadId =
    savedLead?.id ||
    result.data
      ?.result?.id ||
    null;

  console.log(
    "✅ CALLYZER SYNC SUCCESS"
  );

  console.log({
    client,

    callyzerLeadId:
      leadId,

    isNewLead:
      isNewLead ?? "unknown",

    action:
      isNewLead === false
        ? "UPDATED EXISTING LEAD"
        : isNewLead === true
          ? "CREATED NEW LEAD"
          : "CREATED / UPDATED",
  });

  return {
    success: true,

    callyzerLeadId:
      leadId,

    isNewLead,

    response:
      result.data,
  };
}

// ======================================================
// EXACT WEBHOOK DEDUPE
//
// Prevent NeoDove retrying the exact same event
// several times.
// ======================================================

const recentEvents =
  new Map();

function cleanupRecentEvents() {
  const now =
    Date.now();

  for (
    const [key, timestamp]
    of recentEvents.entries()
  ) {
    if (
      now - timestamp >
      EVENT_DEDUPE_MS
    ) {
      recentEvents.delete(
        key
      );
    }
  }
}

function buildEventKey(
  body,
  data
) {
  return [
    data.leadId ||
      data.mobile,

    data.eventName,

    body.time ||
      body.timestamp ||
      "",

    body.call_connected,

    body.dispose_remark ||
      "",

    data.agentNumber ||
      "",

    data.leadStatus ||
      "",
  ].join("|");
}

function isDuplicateEvent(
  eventKey
) {
  cleanupRecentEvents();

  if (
    recentEvents.has(
      eventKey
    )
  ) {
    return true;
  }

  recentEvents.set(
    eventKey,
    Date.now()
  );

  return false;
}

// ======================================================
// BACKGROUND JOB QUEUE
//
// This is what allows:
// Shaon + Fahim + Soma + 20 employees
// to call at the same time.
//
// NeoDove requests are accepted immediately.
// Callyzer is processed safely one-by-one.
// ======================================================

const jobQueue = [];

let workerRunning =
  false;

const failedJobs = [];

const stats = {
  accepted: 0,
  completed: 0,
  failed: 0,
  duplicates: 0,
  ignored: 0,
};

function addFailedJob(
  job,
  error
) {
  failedJobs.unshift({
    id:
      job.id,

    mobile:
      job.data.mobile,

    leadName:
      job.data.leadName,

    agent:
      job.data.agentName,

    error:
      error.message,

    failedAt:
      new Date()
        .toISOString(),
  });

  if (
    failedJobs.length >
    MAX_FAILED_JOBS_STORED
  ) {
    failedJobs.length =
      MAX_FAILED_JOBS_STORED;
  }
}

function enqueueJob(
  data
) {
  const job = {
    id:
      randomUUID(),

    data,

    queuedAt:
      new Date()
        .toISOString(),
  };

  jobQueue.push(job);

  stats.accepted++;

  // Start worker without
  // making webhook wait.
  void runWorker();

  return job;
}

// ======================================================
// QUEUE WORKER
// ======================================================

async function runWorker() {
  // Another worker already
  // processing queue.
  if (workerRunning) {
    return;
  }

  workerRunning =
    true;

  console.log(
    "▶️ Callyzer queue worker started"
  );

  try {
    while (
      jobQueue.length > 0
    ) {
      const job =
        jobQueue.shift();

      console.log(
        "--------------------------------------"
      );

      console.log(
        "PROCESSING QUEUED JOB"
      );

      console.log({
        jobId:
          job.id,

        remaining:
          jobQueue.length,

        lead:
          job.data.leadName,

        mobile:
          job.data.mobile,

        agent:
          job.data.agentName,

        agentNumber:
          job.data.agentNumber,
      });

      console.log(
        "--------------------------------------"
      );

      try {
        const result =
          await syncLeadToCallyzer(
            job.data
          );

        stats.completed++;

        console.log(
          "✅ JOB COMPLETED"
        );

        console.log({
          jobId:
            job.id,

          mobile:
            job.data.mobile,

          result,
        });
      } catch (error) {
        stats.failed++;

        addFailedJob(
          job,
          error
        );

        console.error(
          "❌ JOB FAILED"
        );

        console.error({
          jobId:
            job.id,

          mobile:
            job.data.mobile,

          employee:
            job.data.agentName,

          error:
            error.message,
        });
      }
    }
  } finally {
    workerRunning =
      false;

    console.log(
      "⏹️ Callyzer queue empty"
    );

    // Race protection:
    // something may have entered
    // after while() ended.
    if (
      jobQueue.length > 0
    ) {
      void runWorker();
    }
  }
}

// ======================================================
// NEODOVE WEBHOOK HANDLER
//
// IMPORTANT:
// We DO NOT wait for Callyzer.
//
// NeoDove gets an immediate 200.
// ======================================================

function processNeoDoveWebhook(
  req,
  res
) {
  try {
    // --------------------------------------------------
    // VERIFY SECRET
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
          success: false,

          message:
            "Unauthorized NeoDove webhook",
        });
    }

    // --------------------------------------------------
    // PARSE
    // --------------------------------------------------

    const data =
      parseNeoDoveEvent(
        req.body
      );

    console.log(
      "======================================"
    );

    console.log(
      "NEODOVE EVENT RECEIVED"
    );

    console.log({
      event:
        data.eventName,

      leadId:
        data.leadId,

      leadName:
        data.leadName,

      mobile:
        data.mobile,

      agent:
        data.agentName,

      agentNumber:
        data.agentNumber,

      status:
        data.leadStatus,
    });

    console.log(
      "======================================"
    );

    // --------------------------------------------------
    // MOBILE REQUIRED
    // --------------------------------------------------

    if (
      !data.mobile
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success: true,

          status:
            "ignored_missing_mobile",

          message:
            "Mobile number missing",
        });
    }

    // --------------------------------------------------
    // AGENT REQUIRED
    // --------------------------------------------------

    if (
      !data.agentNumber
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success: true,

          status:
            "ignored_missing_agent",

          message:
            "Agent number missing",
        });
    }

    // --------------------------------------------------
    // VALID PHONE NUMBERS
    // --------------------------------------------------

    if (
      !formatIndianPhone(
        data.mobile
      )
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success: true,

          status:
            "ignored_invalid_mobile",

          message:
            "Invalid client number",
        });
    }

    if (
      !formatIndianPhone(
        data.agentNumber
      )
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success: true,

          status:
            "ignored_invalid_agent",

          message:
            "Invalid agent number",
        });
    }

    // --------------------------------------------------
    // NEO DOVE RETRY DEDUPE
    // --------------------------------------------------

    const eventKey =
      buildEventKey(
        req.body,
        data
      );

    if (
      isDuplicateEvent(
        eventKey
      )
    ) {
      stats.duplicates++;

      console.log(
        "ℹ️ Duplicate webhook ignored"
      );

      return res
        .status(200)
        .json({
          success: true,

          status:
            "duplicate_ignored",

          message:
            "Duplicate NeoDove event ignored",
        });
    }

    // --------------------------------------------------
    // ADD TO QUEUE
    // --------------------------------------------------

    const job =
      enqueueJob(data);

    // --------------------------------------------------
    // RESPOND TO NEODOVE IMMEDIATELY
    // --------------------------------------------------

    return res
      .status(200)
      .json({
        success: true,

        status:
          "queued",

        message:
          "NeoDove event accepted for Callyzer sync",

        job_id:
          job.id,

        queue_position:
          jobQueue.length,

        lead: {
          name:
            data.leadName,

          mobile:
            data.mobile,

          agent_name:
            data.agentName,

          agent_number:
            data.agentNumber,
        },
      });
  } catch (error) {
    console.error(
      "❌ NeoDove webhook error:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        message:
          "Webhook processing failed",

        error:
          error.message,
      });
  }
}

// ======================================================
// ROOT
// ======================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      success: true,

      message:
        "NeoDove → Callyzer middleware is running",

      environment:
        CALLYZER_BASE_URL
          .includes(
            "sandbox"
          )
          ? "sandbox"
          : "production",

      api:
        "/lead/capture",

      assignment:
        "Existing lead owner remains unchanged",

      simultaneousUsers:
        "Queue enabled",
    });
  }
);

// ======================================================
// HEALTH + QUEUE STATUS
// ======================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,

      environment:
        CALLYZER_BASE_URL
          .includes(
            "sandbox"
          )
          ? "sandbox"
          : "production",

      queue: {
        waiting:
          jobQueue.length,

        worker_running:
          workerRunning,
      },

      stats,

      recent_failed_jobs:
        failedJobs.slice(
          0,
          10
        ),
    });
  }
);

// ======================================================
// MAIN NEO DOVE ROUTE
//
// All 3 workflows:
//
// 1. Lead Created
// 2. Call Connected
// 3. Call Not Connected
//
// use this URL.
// ======================================================

app.post(
  "/neodove/call-sync",
  processNeoDoveWebhook
);

// ======================================================
// OLD ROUTE COMPATIBILITY
// ======================================================

app.post(
  "/neodove/lead",
  processNeoDoveWebhook
);
// ======================================================
// TEMPORARY: NEODOVE LEAD DISPOSE DEBUG
// ======================================================

app.post(
  "/neodove/dispose-debug",
  (req, res) => {
    const secret =
      req.get("x-webhook-secret");

    if (
      !NEODOVE_WEBHOOK_SECRET ||
      secret !== NEODOVE_WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized",
        });
    }

    console.log(
      "======================================"
    );

    console.log(
      "🔥 NEODOVE LEAD DISPOSE EVENT"
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

    return res
      .status(200)
      .json({
        success: true,
        message:
          "Lead Dispose payload received",
      });
  }
);
// ======================================================
// 404
// MUST ALWAYS BE LAST
// ======================================================

app.use(
  (req, res) => {
    res
      .status(404)
      .json({
        success: false,

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
      `Environment: ${
        CALLYZER_BASE_URL
          .includes(
            "sandbox"
          )
          ? "SANDBOX"
          : "PRODUCTION"
      }`
    );

    console.log(
      "Callyzer API:"
    );

    console.log(
      "/lead/capture"
    );

    console.log(
      "Multi-user queue: ENABLED"
    );

    console.log(
      "Existing Assign To: IGNORE"
    );

    console.log(
      "======================================"
    );
  }
);