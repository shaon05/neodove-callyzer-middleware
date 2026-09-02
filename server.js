import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// ======================================================
// ENV
// ======================================================

const PORT = Number(process.env.PORT || 3000);

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
  email:
    "InputBox1787666201411",

  address:
    "InputBox1787666201414",

  city:
    "InputBox1787666201418",

  state:
    "InputBox1787666201420",

  zipcode:
    "InputBox1787666201423",

  description:
    "InputBox1787666201429",

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

const MAX_FAILED_JOBS = 50;

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
// PHONE
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

  if (
    number.length !== 10
  ) {
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
// CUSTOM PROPERTY HELPERS
// ======================================================

function searchObjectForProperty(
  object,
  normalizedNames
) {
  if (
    !object ||
    typeof object !== "object" ||
    Array.isArray(object)
  ) {
    return null;
  }

  for (
    const [key, value]
      of Object.entries(object)
  ) {
    if (
      normalizedNames.includes(
        normalizePropertyName(key)
      )
    ) {
      const cleaned =
        cleanValue(value);

      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

function getCustomProperty(
  body,
  possibleNames = []
) {
  const normalizedNames =
    possibleNames.map(
      normalizePropertyName
    );

  const sources = [
    body.contact_custom_properties,
    body.custom_contact_properties,
    body.other_properties,
    body.customer_detail_form_response,
  ];

  for (
    const source of sources
  ) {
    const found =
      searchObjectForProperty(
        source,
        normalizedNames
      );

    if (found) {
      return found;
    }
  }

  // other_properties array format
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
            property?.name ||
            property?.label ||
            property?.key
          );

        if (
          normalizedNames.includes(
            key
          )
        ) {
          const value =
            cleanValue(
              property?.value
            );

          if (value) {
            return value;
          }
        }
      }
    }
  }

  // customer_detail_form_response array
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
        const value =
          cleanValue(
            property?.value
          );

        if (value) {
          return value;
        }
      }
    }
  }

  return null;
}

// ======================================================
// DETECT WHICH NEO DOVE EVENT
//
// SAME URL FOR ALL 3:
//
// call_connected = null
// → Lead Created
//
// call_connected = true
// → Call Connected
//
// call_connected = false
// → Call Not Connected
// ======================================================

function detectSyncType(body) {
  if (
    body.call_connected === true
  ) {
    return "CALL_CONNECTED";
  }

  if (
    body.call_connected === false
  ) {
    return "CALL_NOT_CONNECTED";
  }

  return "LEAD_CREATED";
}

// ======================================================
// PARSE NEO DOVE
// ======================================================

function parseNeoDoveEvent(body) {
  const syncType =
    detectSyncType(body);

  const leadName =
    cleanValue(body.name) ||
    cleanValue(body.lead_name) ||
    cleanValue(
      body.contact_name
    );

  const mobile =
    cleanValue(body.mobile) ||
    cleanValue(body.phone) ||
    cleanValue(
      body.phone_number
    ) ||
    cleanValue(
      body.contact_number
    );

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

  const email =
    cleanValue(body.email) ||
    getCustomProperty(
      body,
      [
        "Email",
        "Email Address",
      ]
    );

  const address =
    cleanValue(body.address) ||
    cleanValue(
      body.address_1
    ) ||
    cleanValue(
      body.address1
    ) ||
    getCustomProperty(
      body,
      [
        "Address",
        "Address 1",
      ]
    );

  const city =
    cleanValue(body.city) ||
    getCustomProperty(
      body,
      ["City"]
    );

  const state =
    cleanValue(body.state) ||
    getCustomProperty(
      body,
      ["State"]
    );

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
    syncType,

    leadName,
    mobile,

    agentName,
    agentNumber,

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
// BUILD CALLYZER CUSTOM FIELDS
// ======================================================

function buildCallyzerFields(
  data
) {
  const fields = {};

  function add(
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

  add(
    CALLYZER_FIELDS.email,
    data.email
  );

  add(
    CALLYZER_FIELDS.address,
    data.address
  );

  add(
    CALLYZER_FIELDS.city,
    data.city
  );

  add(
    CALLYZER_FIELDS.state,
    data.state
  );

  add(
    CALLYZER_FIELDS.zipcode,
    data.zipcode
  );

  add(
    CALLYZER_FIELDS.description,
    data.description
  );

  add(
    CALLYZER_FIELDS.neodoveLeadId,
    data.leadId
  );

  add(
    CALLYZER_FIELDS.neodoveCampaignName,
    data.campaignName
  );

  add(
    CALLYZER_FIELDS.neodoveLeadStatus,
    data.leadStatus
  );

  // ====================================================
  // IMPORTANT:
  //
  // Agent fields represent the NeoDove OWNER.
  //
  // If Fahim only calls Shaon's lead,
  // don't replace owner fields with Fahim.
  //
  // Callyzer handles Last Call Employee separately.
  // ====================================================

  if (
    data.syncType ===
    "LEAD_CREATED"
  ) {
    add(
      CALLYZER_FIELDS.neodoveAgentName,
      data.agentName
    );

    add(
      CALLYZER_FIELDS.neodoveAgentNumber,
      data.agentNumber
    );
  }

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
      raw_response:
        text,
    };
  }
}

// ======================================================
// CALLYZER POST
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

      const data =
        await readApiResponse(
          response
        );

      if (response.ok) {
        return {
          success:
            true,

          httpStatus:
            response.status,

          data,
        };
      }

      // RATE LIMIT RETRY
      if (
        response.status ===
          429 &&
        attempt < 3
      ) {
        const retryAfter =
          Number(
            response.headers.get(
              "retry-after"
            )
          );

        const waitMs =
          Number.isFinite(
            retryAfter
          ) &&
          retryAfter > 0
            ? retryAfter *
              1000
            : 2500;

        console.log(
          `⚠️ Callyzer rate limit. Retry in ${waitMs}ms`
        );

        await sleep(
          waitMs
        );

        continue;
      }

      return {
        success:
          false,

        httpStatus:
          response.status,

        data,
      };
    } catch (error) {
      if (
        attempt < 3
      ) {
        console.error(
          `⚠️ Network error: ${error.message}`
        );

        await sleep(
          2500
        );

        continue;
      }

      return {
        success:
          false,

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
// SYNC ONE LEAD
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

  // Callyzer first_name minimum = 3 chars
  if (
    !finalName ||
    finalName.length < 3
  ) {
    finalName =
      localNumber;
  }

  const isLeadCreated =
    data.syncType ===
    "LEAD_CREATED";

  const fields =
    buildCallyzerFields(
      data
    );

  // ====================================================
  // INDIVIDUAL LEAD
  // ====================================================

  const lead = {
    first_name:
      finalName,

    contact_numbers: [
      client,
    ],
  };

  if (
    Object.keys(
      fields
    ).length > 0
  ) {
    lead.fields =
      fields;
  }

  // ====================================================
  // IMPORTANT FIX
  //
  // /lead/capture expects:
  //
  // {
  //   leads: [...]
  // }
  //
  // This fixes:
  //
  // "Leads cannot be null"
  // ====================================================

  const payload = {
    leads: [
      lead,
    ],

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employee,
      ],
    },

    existing_lead: {
      // Update status,
      // description,
      // email,
      // campaign etc.
      lead_details:
        "overwrite",

      // ==================================================
      // FINAL ASSIGNMENT LOGIC
      //
      // Lead Created
      // → set Callyzer owner
      //
      // Call Connected
      // → preserve owner
      //
      // Call Not Connected
      // → preserve owner
      // ==================================================

      assignee:
        isLeadCreated
          ? "overwrite"
          : "ignore",

      lead_tags:
        "ignore",
    },

    is_map_existing_call_logs:
      true,
  };

  // ====================================================
  // LOG
  // ====================================================

  console.log(
    "======================================"
  );

  console.log(
    "SYNCING LEAD TO CALLYZER"
  );

  console.log({
    syncType:
      data.syncType,

    name:
      finalName,

    client,

    incomingAgent:
      employee,

    incomingAgentName:
      data.agentName,

    neoDoveStatus:
      data.leadStatus,

    assignmentAction:
      isLeadCreated
        ? "OVERWRITE"
        : "IGNORE",

    assignmentMeaning:
      isLeadCreated
        ? "Set owner from NeoDove"
        : "Call event - preserve owner",

    fields:
      Object.keys(
        fields
      ).length,
  });

  console.log(
    "PAYLOAD:"
  );

  console.log(
    JSON.stringify(
      payload,
      null,
      2
    )
  );

  console.log(
    "======================================"
  );

  // ====================================================
  // SEND TO CALLYZER
  // ====================================================

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

  // ====================================================
  // CALLYZER CAN RETURN 200 WITH PER-LEAD ERRORS
  // ====================================================

  const savedLeads =
    Array.isArray(
      result.data
        ?.result
        ?.savedLeads
    )
      ? result.data
          .result
          .savedLeads
      : [];

  const errors =
    Array.isArray(
      result.data
        ?.result
        ?.errors
    )
      ? result.data
          .result
          .errors
      : [];

  if (
    savedLeads.length === 0 &&
    errors.length > 0
  ) {
    throw new Error(
      `Callyzer lead error: ${JSON.stringify(
        errors
      )}`
    );
  }

  const savedLead =
    savedLeads[0] ||
    null;

  console.log(
    "✅ CALLYZER SYNC SUCCESS"
  );

  console.log({
    syncType:
      data.syncType,

    callyzerLeadId:
      savedLead?.id ||
      null,

    isNewLead:
      savedLead
        ?.is_new_lead ??
      null,

    assignmentAction:
      isLeadCreated
        ? "SET FROM NEODOVE"
        : "PRESERVED",
  });

  return {
    success:
      true,

    syncType:
      data.syncType,

    callyzerLeadId:
      savedLead?.id ||
      null,

    isNewLead:
      savedLead
        ?.is_new_lead ??
      null,

    response:
      result.data,
  };
}

// ======================================================
// DUPLICATE EVENT PROTECTION
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
    data.syncType,

    data.leadId ||
      data.mobile,

    body.time ||
      body.timestamp ||
      "",

    String(
      body.call_connected
    ),

    data.agentNumber ||
      "",

    data.leadStatus ||
      "",

    body.dispose_remark ||
      body.dispose_remarks ||
      "",
  ].join("|");
}

function isDuplicateEvent(
  key
) {
  cleanupRecentEvents();

  if (
    recentEvents.has(
      key
    )
  ) {
    return true;
  }

  recentEvents.set(
    key,
    Date.now()
  );

  return false;
}

// ======================================================
// MULTI USER QUEUE
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

  leadCreated: 0,

  callConnected: 0,

  callNotConnected: 0,
};

// ======================================================
// FAILED JOB
// ======================================================

function storeFailedJob(
  job,
  error
) {
  failedJobs.unshift({
    id:
      job.id,

    syncType:
      job.data.syncType,

    leadName:
      job.data.leadName,

    mobile:
      job.data.mobile,

    agentName:
      job.data.agentName,

    agentNumber:
      job.data.agentNumber,

    error:
      error.message,

    failedAt:
      new Date()
        .toISOString(),
  });

  if (
    failedJobs.length >
    MAX_FAILED_JOBS
  ) {
    failedJobs.length =
      MAX_FAILED_JOBS;
  }
}

// ======================================================
// ADD JOB
// ======================================================

function enqueueJob(data) {
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

  if (
    data.syncType ===
    "LEAD_CREATED"
  ) {
    stats.leadCreated++;
  }

  if (
    data.syncType ===
    "CALL_CONNECTED"
  ) {
    stats.callConnected++;
  }

  if (
    data.syncType ===
    "CALL_NOT_CONNECTED"
  ) {
    stats.callNotConnected++;
  }

  // Process in background.
  void runWorker();

  return job;
}

// ======================================================
// QUEUE WORKER
//
// 10-20 employees can trigger events at once.
//
// Render accepts all immediately.
//
// Callyzer receives them one-by-one.
// ======================================================

async function runWorker() {
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

        syncType:
          job.data.syncType,

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

          result,
        });
      } catch (error) {
        stats.failed++;

        storeFailedJob(
          job,
          error
        );

        console.error(
          "❌ JOB FAILED"
        );

        console.error({
          jobId:
            job.id,

          syncType:
            job.data.syncType,

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

    // Race protection
    if (
      jobQueue.length > 0
    ) {
      void runWorker();
    }
  }
}

// ======================================================
// NEO DOVE WEBHOOK
// ======================================================

function handleNeoDoveWebhook(
  req,
  res
) {
  try {
    // ==================================================
    // SECURITY
    // ==================================================

    const receivedSecret =
      req.get(
        "x-webhook-secret"
      );

    if (
      !NEODOVE_WEBHOOK_SECRET ||
      receivedSecret !==
        NEODOVE_WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .json({
          success:
            false,

          message:
            "Unauthorized NeoDove webhook",
        });
    }

    // ==================================================
    // PARSE
    // ==================================================

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
      syncType:
        data.syncType,

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

    // ==================================================
    // MOBILE CHECK
    // ==================================================

    if (
      !data.mobile ||
      !formatIndianPhone(
        data.mobile
      )
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success:
            true,

          status:
            "ignored_invalid_mobile",

          message:
            "Missing or invalid client mobile number",
        });
    }

    // ==================================================
    // AGENT CHECK
    // ==================================================

    if (
      !data.agentNumber ||
      !formatIndianPhone(
        data.agentNumber
      )
    ) {
      stats.ignored++;

      return res
        .status(200)
        .json({
          success:
            true,

          status:
            "ignored_invalid_agent",

          message:
            "Missing or invalid NeoDove agent number",
        });
    }

    // ==================================================
    // DUPLICATE CHECK
    // ==================================================

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

      return res
        .status(200)
        .json({
          success:
            true,

          status:
            "duplicate_ignored",

          message:
            "Duplicate NeoDove event ignored",
        });
    }

    // ==================================================
    // ADD TO QUEUE
    // ==================================================

    const job =
      enqueueJob(data);

    // ==================================================
    // RESPOND TO NEO DOVE IMMEDIATELY
    // ==================================================

    return res
      .status(200)
      .json({
        success:
          true,

        status:
          "queued",

        message:
          "NeoDove event queued for Callyzer sync",

        jobId:
          job.id,

        syncType:
          data.syncType,

        queueWaiting:
          jobQueue.length,

        lead: {
          id:
            data.leadId,

          name:
            data.leadName,

          mobile:
            data.mobile,

          agentName:
            data.agentName,

          agentNumber:
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
        success:
          false,

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
      success:
        true,

      message:
        "NeoDove → Callyzer middleware is running",

      environment:
        CALLYZER_BASE_URL.includes(
          "sandbox"
        )
          ? "sandbox"
          : "production",

      webhook:
        "/neodove/call-sync",

      rules: {
        leadCreated:
          "Set Callyzer Assign To from NeoDove agent",

        callConnected:
          "Preserve existing Callyzer Assign To",

        callNotConnected:
          "Preserve existing Callyzer Assign To",

        lastCallEmployee:
          "Managed by Callyzer Biz / call logs",

        reassignment:
          "Not synced",
      },
    });
  }
);

// ======================================================
// HEALTH
// ======================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      success:
        true,

      environment:
        CALLYZER_BASE_URL.includes(
          "sandbox"
        )
          ? "sandbox"
          : "production",

      queue: {
        waiting:
          jobQueue.length,

        workerRunning,
      },

      stats,

      failedJobs:
        failedJobs.slice(
          0,
          10
        ),
    });
  }
);

// ======================================================
// ONE URL FOR ALL THREE WORKFLOWS
//
// 1. Lead Created
// 2. Call Connected
// 3. Call Not Connected
//
// ALL USE:
// /neodove/call-sync
// ======================================================

app.post(
  "/neodove/call-sync",
  handleNeoDoveWebhook
);

// ======================================================
// OLD URL COMPATIBILITY
//
// Keep temporarily in case an old
// NeoDove webhook still uses /neodove/lead.
// ======================================================

app.post(
  "/neodove/lead",
  handleNeoDoveWebhook
);

// ======================================================
// 404
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
// START
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
        CALLYZER_BASE_URL.includes(
          "sandbox"
        )
          ? "SANDBOX"
          : "PRODUCTION"
      }`
    );

    console.log(
      "Webhook: /neodove/call-sync"
    );

    console.log(
      ""
    );

    console.log(
      "Lead Created → set assignment"
    );

    console.log(
      "Call Connected → preserve assignment"
    );

    console.log(
      "Call Not Connected → preserve assignment"
    );

    console.log(
      "Last Call Employee → Callyzer Biz"
    );

    console.log(
      "Multi-user queue → ENABLED"
    );

    console.log(
      "======================================"
    );
  }
);