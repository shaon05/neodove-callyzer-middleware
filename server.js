import "dotenv/config";

import express from "express";
import helmet from "helmet";

import {
  randomUUID,
} from "node:crypto";

// ======================================================
// APP
// ======================================================

const app = express();

app.use(helmet());

app.use(
  express.json({
    limit: "1mb",
  })
);

// ======================================================
// ENVIRONMENT
// ======================================================

const PORT =
  Number(
    process.env.PORT || 3000
  );

const CALLYZER_API_KEY =
  process.env.CALLYZER_API_KEY;

const CALLYZER_BASE_URL =
  String(
    process.env.CALLYZER_BASE_URL || ""
  ).replace(/\/+$/, "");

const NEODOVE_WEBHOOK_SECRET =
  process.env
    .NEODOVE_WEBHOOK_SECRET;

const CALLYZER_UNMAPPED_EMPLOYEE_NUMBER =
  process.env
    .CALLYZER_UNMAPPED_EMPLOYEE_NUMBER;

// ======================================================
// CALLYZER CUSTOM FIELDS
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
// CONFIGURATION
// ======================================================

// Callyzer allows one API request
// approximately every two seconds.
const CALLYZER_MIN_GAP_MS =
  2200;

// Refresh employee list every
// 5 minutes.
const EMPLOYEE_CACHE_MS =
  5 * 60 * 1000;

// NeoDove duplicate webhook protection.
const EVENT_DEDUPE_MS =
  10 * 60 * 1000;

const MAX_FAILED_JOBS =
  50;

// ======================================================
// OPTIONAL EMPLOYEE NAME ALIASES
//
// Use this only when the SAME PERSON has
// different names in NeoDove and Callyzer.
//
// Exact phone-number matching always has priority.
// ======================================================

const EMPLOYEE_NAME_ALIASES = {
  "sk fahim":
    "fahim",

  "shaon":
    "shaon howlader",
};

// ======================================================
// ENV CHECK
// ======================================================

function checkEnvironment() {
  const missing = [];

  if (!CALLYZER_API_KEY) {
    missing.push(
      "CALLYZER_API_KEY"
    );
  }

  if (!CALLYZER_BASE_URL) {
    missing.push(
      "CALLYZER_BASE_URL"
    );
  }

  if (!NEODOVE_WEBHOOK_SECRET) {
    missing.push(
      "NEODOVE_WEBHOOK_SECRET"
    );
  }

  if (
    !CALLYZER_UNMAPPED_EMPLOYEE_NUMBER
  ) {
    missing.push(
      "CALLYZER_UNMAPPED_EMPLOYEE_NUMBER"
    );
  }

  if (missing.length > 0) {
    console.warn(
      `⚠️ Missing ENV: ${missing.join(
        ", "
      )}`
    );
  }
}

checkEnvironment();

// ======================================================
// BASIC HELPERS
// ======================================================

function sleep(ms) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}

function cleanValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function normalizePropertyName(
  value
) {
  return String(value || "")
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function normalizeEmployeeName(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[_\-]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    );
}

// ======================================================
// PHONE HELPERS
// ======================================================

function localIndianNumber(
  phone
) {
  if (!phone) {
    return null;
  }

  let number =
    String(phone)
      .replace(
        /\D/g,
        ""
      );

  // Example:
  // 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number =
      number.slice(1);
  }

  // Example:
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

function formatIndianPhone(
  phone
) {
  const local =
    localIndianNumber(
      phone
    );

  if (!local) {
    return null;
  }

  return `91-${local}`;
}

// ======================================================
// CUSTOM PROPERTY HELPERS
// ======================================================

function searchObjectProperty(
  object,
  normalizedNames
) {
  if (
    !object ||
    typeof object !==
      "object" ||
    Array.isArray(object)
  ) {
    return null;
  }

  for (
    const [key, value]
      of Object.entries(
        object
      )
  ) {
    if (
      normalizedNames.includes(
        normalizePropertyName(
          key
        )
      )
    ) {
      const cleaned =
        cleanValue(
          value
        );

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

  const directSources = [
    body
      .contact_custom_properties,

    body
      .custom_contact_properties,

    body
      .other_properties,

    body
      .customer_detail_form_response,
  ];

  // ====================================================
  // OBJECT FORM
  // ====================================================

  for (
    const source
      of directSources
  ) {
    const found =
      searchObjectProperty(
        source,
        normalizedNames
      );

    if (found) {
      return found;
    }
  }

  // ====================================================
  // other_properties ARRAY FORM
  // ====================================================

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

  // ====================================================
  // customer_detail_form_response ARRAY
  // ====================================================

  if (
    Array.isArray(
      body
        .customer_detail_form_response
    )
  ) {
    for (
      const property
        of body
          .customer_detail_form_response
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
// DETECT NEODOVE EVENT
//
// One URL handles:
//
// Lead Created
// Call Connected
// Call Not Connected
// ======================================================

function detectSyncType(body) {
  const eventName =
    String(
      body.event_name || ""
    )
      .trim()
      .toUpperCase();

  if (
    eventName ===
      "CALL_CONNECTED" ||
    body.call_connected ===
      true
  ) {
    return "CALL_CONNECTED";
  }

  if (
    eventName ===
      "CALL_NOT_CONNECTED" ||
    body.call_connected ===
      false
  ) {
    return "CALL_NOT_CONNECTED";
  }

  return "LEAD_CREATED";
}

// ======================================================
// PARSE NEODOVE EVENT
// ======================================================

function parseNeoDoveEvent(
  body
) {
  const syncType =
    detectSyncType(body);

  const leadName =
    cleanValue(
      body.name
    ) ||
    cleanValue(
      body.lead_name
    ) ||
    cleanValue(
      body.contact_name
    );

  const mobile =
    cleanValue(
      body.mobile
    ) ||
    cleanValue(
      body.phone
    ) ||
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
    cleanValue(
      body.email
    ) ||
    getCustomProperty(
      body,
      [
        "Email",
        "Email Address",
      ]
    );

  const address =
    cleanValue(
      body.address
    ) ||
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
    cleanValue(
      body.city
    ) ||
    getCustomProperty(
      body,
      [
        "City",
      ]
    );

  const state =
    cleanValue(
      body.state
    ) ||
    getCustomProperty(
      body,
      [
        "State",
      ]
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
      [
        "Description",
      ]
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
// CALLYZER CUSTOM FIELDS
//
// IMPORTANT:
//
// We ALWAYS keep the real NeoDove agent information,
// even when Callyzer uses "NeoDove Unmapped".
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
      cleanValue(
        value
      );

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
    CALLYZER_FIELDS
      .neodoveCampaignName,
    data.campaignName
  );

  add(
    CALLYZER_FIELDS
      .neodoveLeadStatus,
    data.leadStatus
  );

  // ====================================================
  // REAL NEO DOVE AGENT
  //
  // These are NOT replaced with the generic
  // Callyzer employee.
  // ====================================================

  add(
    CALLYZER_FIELDS
      .neodoveAgentName,
    data.agentName
  );

  add(
    CALLYZER_FIELDS
      .neodoveAgentNumber,
    data.agentNumber
  );

  return fields;
}

// ======================================================
// CALLYZER RATE LIMIT
// ======================================================

let lastCallyzerRequestAt =
  0;

async function waitForCallyzerSlot() {
  const elapsed =
    Date.now() -
    lastCallyzerRequestAt;

  if (
    elapsed <
    CALLYZER_MIN_GAP_MS
  ) {
    const waitMs =
      CALLYZER_MIN_GAP_MS -
      elapsed;

    console.log(
      `⏳ Callyzer API wait: ${waitMs}ms`
    );

    await sleep(
      waitMs
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

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    return {
      raw_response:
        text,
    };
  }
}

// ======================================================
// CALLYZER GET
// ======================================================

async function callyzerGet(
  path,
  params = {}
) {
  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      await waitForCallyzerSlot();

      const url =
        new URL(
          `${CALLYZER_BASE_URL}${path}`
        );

      for (
        const [key, value]
          of Object.entries(
            params
          )
      ) {
        if (
          value === undefined ||
          value === null ||
          value === ""
        ) {
          continue;
        }

        if (
          Array.isArray(value)
        ) {
          for (
            const item of value
          ) {
            url.searchParams.append(
              key,
              item
            );
          }
        } else {
          url.searchParams.set(
            key,
            String(value)
          );
        }
      }

      const response =
        await fetch(
          url.toString(),
          {
            method:
              "GET",

            headers: {
              Authorization:
                `Bearer ${CALLYZER_API_KEY}`,

              Accept:
                "application/json",
            },
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

      if (
        response.status === 429 &&
        attempt < 3
      ) {
        console.log(
          "⚠️ Callyzer GET rate limit"
        );

        await sleep(
          2500
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
        await sleep(
          2500
        );

        continue;
      }

      return {
        success:
          false,

        httpStatus:
          0,

        data: {
          message:
            error.message,
        },
      };
    }
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

      if (
        response.status === 429 &&
        attempt < 3
      ) {
        console.log(
          "⚠️ Callyzer POST rate limit"
        );

        await sleep(
          2500
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
        await sleep(
          2500
        );

        continue;
      }

      return {
        success:
          false,

        httpStatus:
          0,

        data: {
          message:
            error.message,
        },
      };
    }
  }
}

// ======================================================
// CALLYZER EMPLOYEE CACHE
// ======================================================

let employeeCache = {
  employees: [],

  fetchedAt: 0,
};

// ======================================================
// FETCH ALL ACTIVE CALLYZER EMPLOYEES
// ======================================================

async function fetchCallyzerEmployees() {
  const allEmployees =
    [];

  let page = 1;

  while (true) {
    const response =
      await callyzerGet(
        "/employee/get",
        {
          page_no:
            page,

          page_size:
            100,
        }
      );

    if (!response.success) {
      throw new Error(
        `Unable to fetch Callyzer employees: ${JSON.stringify(
          response.data
        )}`
      );
    }

    const employees =
      Array.isArray(
        response.data?.result
      )
        ? response.data.result
        : [];

    allEmployees.push(
      ...employees
    );

    const totalRecords =
      Number(
        response.data
          ?.total_records ||
          employees.length
      );

    if (
      allEmployees.length >=
        totalRecords ||
      employees.length < 100
    ) {
      break;
    }

    page++;
  }

  return allEmployees;
}

// ======================================================
// GET EMPLOYEES WITH CACHE
// ======================================================

async function getCallyzerEmployees(
  forceRefresh = false
) {
  const now =
    Date.now();

  const cacheValid =
    employeeCache
      .employees.length > 0 &&
    now -
      employeeCache.fetchedAt <
      EMPLOYEE_CACHE_MS;

  if (
    cacheValid &&
    !forceRefresh
  ) {
    return employeeCache
      .employees;
  }

  console.log(
    "🔄 Fetching Callyzer employees..."
  );

  const employees =
    await fetchCallyzerEmployees();

  employeeCache = {
    employees,

    fetchedAt:
      Date.now(),
  };

  console.log(
    `✅ Callyzer employees loaded: ${employees.length}`
  );

  return employees;
}

// ======================================================
// FIND CALLYZER EMPLOYEE
// ======================================================

function findEmployeeByNumber(
  employees,
  phone
) {
  const target =
    localIndianNumber(
      phone
    );

  if (!target) {
    return null;
  }

  return (
    employees.find(
      (employee) =>
        localIndianNumber(
          employee.emp_number
        ) === target
    ) || null
  );
}

function findEmployeeByName(
  employees,
  name
) {
  const normalized =
    normalizeEmployeeName(
      name
    );

  if (!normalized) {
    return null;
  }

  const target =
    EMPLOYEE_NAME_ALIASES[
      normalized
    ] ||
    normalized;

  const matches =
    employees.filter(
      (employee) =>
        normalizeEmployeeName(
          employee.emp_name
        ) === target
    );

  // Never guess if duplicate names exist.
  if (
    matches.length !== 1
  ) {
    return null;
  }

  return matches[0];
}

// ======================================================
// EMPLOYEE RESOLVER
//
// Priority:
//
// 1. NeoDove number exists in Callyzer
// 2. Exact/explicit alias name match
// 3. NeoDove Unmapped fallback
// ======================================================

async function resolveCallyzerEmployee(
  data
) {
  const employees =
    await getCallyzerEmployees();

  // ====================================================
  // 1. NUMBER MATCH
  // ====================================================

  const numberMatch =
    findEmployeeByNumber(
      employees,
      data.agentNumber
    );

  if (numberMatch) {
    console.log(
      "✅ Employee matched by phone",
      {
        neoDove:
          data.agentName,

        callyzer:
          numberMatch.emp_name,

        number:
          numberMatch.emp_number,
      }
    );

    return {
      employee:
        numberMatch,

      mapped:
        true,

      matchType:
        "NUMBER",
    };
  }

  // ====================================================
  // 2. NAME MATCH
  //
  // Useful when same employee has a different
  // number/name between systems.
  // ====================================================

  const nameMatch =
    findEmployeeByName(
      employees,
      data.agentName
    );

  if (nameMatch) {
    console.log(
      "✅ Employee matched by name",
      {
        neoDove:
          data.agentName,

        neoDoveNumber:
          data.agentNumber,

        callyzer:
          nameMatch.emp_name,

        callyzerNumber:
          nameMatch.emp_number,
      }
    );

    return {
      employee:
        nameMatch,

      mapped:
        true,

      matchType:
        "NAME",
    };
  }

  // ====================================================
  // 3. GENERIC UNMAPPED EMPLOYEE
  // ====================================================

  const fallback =
    findEmployeeByNumber(
      employees,
      CALLYZER_UNMAPPED_EMPLOYEE_NUMBER
    );

  if (!fallback) {
    throw new Error(
      "NeoDove Unmapped employee is not registered in Callyzer or Lead feature is disabled."
    );
  }

  console.log(
    "⚠️ NeoDove employee not registered in Callyzer",
    {
      neoDoveAgent:
        data.agentName,

      neoDoveNumber:
        data.agentNumber,

      assignedTo:
        fallback.emp_name,

      assignedNumber:
        fallback.emp_number,
    }
  );

  return {
    employee:
      fallback,

    mapped:
      false,

    matchType:
      "UNMAPPED",
  };
}

// ======================================================
// SYNC LEAD TO CALLYZER
// ======================================================

async function syncLeadToCallyzer(
  data
) {
  const client =
    formatIndianPhone(
      data.mobile
    );

  if (!client) {
    throw new Error(
      `Invalid client number: ${data.mobile}`
    );
  }

  // ====================================================
  // RESOLVE EMPLOYEE
  // ====================================================

  const resolution =
    await resolveCallyzerEmployee(
      data
    );

  const employee =
    resolution.employee;

  const employeePhone =
    formatIndianPhone(
      employee.emp_number
    );

  if (!employeePhone) {
    throw new Error(
      `Invalid Callyzer employee number: ${employee.emp_number}`
    );
  }

  // ====================================================
  // LEAD NAME
  // ====================================================

  const local =
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
      local;
  }

  const fields =
    buildCallyzerFields(
      data
    );

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
  // ASSIGNMENT LOGIC
  //
  // Lead Created:
  // overwrite owner.
  //
  // Call Event:
  // preserve existing owner.
  //
  // BUT if call event creates a brand-new bulk lead,
  // assignment is still required and the resolved
  // employee / Unmapped employee is used.
  // ====================================================

  const isLeadCreated =
    data.syncType ===
    "LEAD_CREATED";

  const payload = {
    leads: [
      lead,
    ],

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employeePhone,
      ],
    },

    existing_lead: {
      lead_details:
        "overwrite",

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

    leadName:
      finalName,

    client,

    neoDoveAgent:
      data.agentName,

    neoDoveNumber:
      data.agentNumber,

    employeeMapped:
      resolution.mapped,

    matchType:
      resolution.matchType,

    callyzerAssignTo:
      employee.emp_name,

    callyzerEmployeeNumber:
      employee.emp_number,

    campaign:
      data.campaignName,

    status:
      data.leadStatus,

    assignmentAction:
      isLeadCreated
        ? "OVERWRITE"
        : "IGNORE",
  });

  console.log(
    "FIELDS:"
  );

  console.log(
    JSON.stringify(
      fields,
      null,
      2
    )
  );

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
  // CAPTURE LEAD
  // ====================================================

  const result =
    await callyzerPost(
      "/lead/capture",
      payload
    );

  if (!result.success) {
    throw new Error(
      `Callyzer API ${result.httpStatus}: ${JSON.stringify(
        result.data
      )}`
    );
  }

  // ====================================================
  // PER-LEAD RESPONSE
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
    lead:
      finalName,

    callyzerLeadId:
      savedLead?.id ||
      null,

    isNewLead:
      savedLead
        ?.is_new_lead ??
      null,

    employeeMapped:
      resolution.mapped,

    callyzerAssignedTo:
      employee.emp_name,

    actualNeoDoveAgent:
      data.agentName,
  });

  return {
    success:
      true,

    callyzerLeadId:
      savedLead?.id ||
      null,

    isNewLead:
      savedLead
        ?.is_new_lead ??
      null,

    employee: {
      mapped:
        resolution.mapped,

      matchType:
        resolution.matchType,

      callyzerName:
        employee.emp_name,

      callyzerNumber:
        employee.emp_number,

      neodoveName:
        data.agentName,

      neodoveNumber:
        data.agentNumber,
    },

    response:
      result.data,
  };
}

// ======================================================
// DUPLICATE PROTECTION
// ======================================================

const recentEvents =
  new Map();

function cleanupRecentEvents() {
  const now =
    Date.now();

  for (
    const [key, time]
      of recentEvents.entries()
  ) {
    if (
      now - time >
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
// MULTI-USER QUEUE
// ======================================================

const jobQueue =
  [];

let workerRunning =
  false;

const failedJobs =
  [];

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
// FAILED JOB STORE
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

    lead:
      job.data.leadName,

    mobile:
      job.data.mobile,

    agent:
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
// QUEUE EVENT
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

  jobQueue.push(
    job
  );

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

  void runWorker();

  return job;
}

// ======================================================
// QUEUE WORKER
// ======================================================

async function runWorker() {
  if (workerRunning) {
    return;
  }

  workerRunning =
    true;

  console.log(
    "▶️ Queue worker started"
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
        "PROCESSING JOB"
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

        agent:
          job.data.agentName,
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

          lead:
            job.data.leadName,

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
      "⏹️ Queue empty"
    );

    if (
      jobQueue.length > 0
    ) {
      void runWorker();
    }
  }
}

// ======================================================
// NEO DOVE WEBHOOK HANDLER
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
    // PARSE EVENT
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

      lead:
        data.leadName,

      mobile:
        data.mobile,

      agent:
        data.agentName,

      agentNumber:
        data.agentNumber,

      campaign:
        data.campaignName,

      status:
        data.leadStatus,
    });

    console.log(
      "======================================"
    );

    // ==================================================
    // CLIENT NUMBER VALIDATION
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
        });
    }

    // ==================================================
    // NEO DOVE AGENT
    //
    // We need the NeoDove number for mapping
    // and custom fields.
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
        });
    }

    // ==================================================
    // DEDUPE
    // ==================================================

    const key =
      buildEventKey(
        req.body,
        data
      );

    if (
      isDuplicateEvent(
        key
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
        });
    }

    // ==================================================
    // QUEUE
    // ==================================================

    const job =
      enqueueJob(
        data
      );

    // Respond immediately.
    return res
      .status(200)
      .json({
        success:
          true,

        status:
          "queued",

        jobId:
          job.id,

        syncType:
          data.syncType,

        queueWaiting:
          jobQueue.length,

        lead: {
          name:
            data.leadName,

          mobile:
            data.mobile,

          agent:
            data.agentName,

          agentNumber:
            data.agentNumber,

          campaign:
            data.campaignName,
        },
      });
  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return res
      .status(500)
      .json({
        success:
          false,

        message:
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
        "NeoDove → Callyzer middleware running",

      environment:
        CALLYZER_BASE_URL.includes(
          "sandbox"
        )
          ? "sandbox"
          : "production",

      webhook:
        "/neodove/call-sync",

      employeeMapping: {
        registered:
          "Use real Callyzer employee",

        unregistered:
          "Use NeoDove Unmapped employee",

        realAgentData:
          "Stored in NeoDove Agent custom fields",
      },

      assignment: {
        leadCreated:
          "Set assignment",

        callEvent:
          "Preserve existing assignment",
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

      queue: {
        waiting:
          jobQueue.length,

        workerRunning,
      },

      employeeCache: {
        count:
          employeeCache
            .employees.length,

        fetchedAt:
          employeeCache.fetchedAt
            ? new Date(
                employeeCache
                  .fetchedAt
              ).toISOString()
            : null,
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
// FORCE EMPLOYEE CACHE REFRESH
//
// Useful immediately after registering
// a new employee in Callyzer.
// ======================================================

app.post(
  "/callyzer/refresh-employees",
  async (
    req,
    res
  ) => {
    try {
      const secret =
        req.get(
          "x-webhook-secret"
        );

      if (
        secret !==
        NEODOVE_WEBHOOK_SECRET
      ) {
        return res
          .status(401)
          .json({
            success:
              false,
          });
      }

      const employees =
        await getCallyzerEmployees(
          true
        );

      return res.json({
        success:
          true,

        employees:
          employees.map(
            (employee) => ({
              name:
                employee.emp_name,

              number:
                employee.emp_number,

              leadEnabled:
                employee
                  .is_lead_active,
            })
          ),
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success:
            false,

          message:
            error.message,
        });
    }
  }
);

// ======================================================
// ONE URL FOR ALL THREE NEO DOVE WORKFLOWS
// ======================================================

app.post(
  "/neodove/call-sync",
  handleNeoDoveWebhook
);

// ======================================================
// OLD URL COMPATIBILITY
// ======================================================

app.post(
  "/neodove/lead",
  handleNeoDoveWebhook
);

// ======================================================
// 404
// ======================================================

app.use(
  (
    req,
    res
  ) => {
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
      "Employee Resolver: ENABLED"
    );

    console.log(
      "Registered NeoDove user → real Callyzer employee"
    );

    console.log(
      "Unregistered NeoDove user → NeoDove Unmapped"
    );

    console.log(
      "Real NeoDove agent → stored in custom fields"
    );

    console.log(
      "Multi-user queue → ENABLED"
    );

    console.log(
      "======================================"
    );
  }
);