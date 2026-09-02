import "dotenv/config";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import ExcelJS from "exceljs";

const NEODOVE_IMPORT_URL =
  process.env.NEODOVE_IMPORT_URL;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const CALLYZER_API_KEY = process.env.CALLYZER_API_KEY;
const CALLYZER_BASE_URL = process.env.CALLYZER_BASE_URL;

const NEODOVE_WEBHOOK_SECRET =
  process.env.NEODOVE_WEBHOOK_SECRET;

const CALLYZER_WEBHOOK_SECRET =
  process.env.CALLYZER_WEBHOOK_SECRET;


// ======================================================
// PHONE FORMATTER
// ======================================================

function formatIndianPhone(phone) {
  if (!phone) return null;

  let number = String(phone).replace(/\D/g, "");

  // Example: 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number = number.slice(1);
  }

  // Example: 9876543210
  if (number.length === 10) {
    return `91-${number}`;
  }

  // Example: 919876543210
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    return `91-${number.slice(2)}`;
  }

  return null;
}


// ======================================================
// READ API RESPONSE
// ======================================================

async function readResponse(response) {
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
// DUPLICATE LEAD CHECK
// ======================================================

function isDuplicateLead(data) {
  const text =
    JSON.stringify(data || {})
      .toLowerCase();

  return (
    text.includes("already exists") ||
    text.includes("already exist") ||
    text.includes("duplicate")
  );
}


// ======================================================
// CREATE CALLYZER LEAD
// ======================================================

async function createCallyzerLead(
  clientNumber,
  employeeNumber,
  clientName = null
) {
  const client =
    formatIndianPhone(clientNumber);

  const employee =
    formatIndianPhone(employeeNumber);

  if (!client) {
    return {
      success: false,
      status: "invalid_client_number",
      clientNumber,
    };
  }

  if (!employee) {
    return {
      success: false,
      status: "invalid_employee_number",
      employeeNumber,
    };
  }

  const localNumber =
    client.split("-")[1];

  let finalName =
    String(clientName || "").trim();

  if (!finalName) {
    finalName = localNumber;
  }

  const payload = {
    first_name: finalName,

    contact_numbers: [
      client,
    ],

    assignment: {
      strategy:
        "Assign to All Selected",

      emp_numbers: [
        employee,
      ],
    },

    is_map_existing_call_logs:
      true,
  };


  console.log(
    "--------------------------------------"
  );

  console.log(
    "Creating Callyzer lead"
  );

  console.log({
    name: finalName,
    client,
    employee,
  });

  console.log(
    "--------------------------------------"
  );


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
          JSON.stringify(payload),
      }
    );


  const data =
    await readResponse(response);


  if (response.ok) {
    return {
      success: true,
      status: "created",
      data,
    };
  }


  if (isDuplicateLead(data)) {
    return {
      success: true,
      status: "already_exists",
      data,
    };
  }


  return {
    success: false,
    status: "failed",
    httpStatus:
      response.status,
    data,
  };
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
// NEODOVE LEAD → CALLYZER
//
// NeoDove decides employee.
// Render copies that employee to Callyzer.
// ======================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\n/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


// Excel column → NeoDove path
const EXCEL_FIELD_MAP = {
  // Required phone aliases
  "mobile": "mobile",
  "mobile no": "mobile",
  "mobile number": "mobile",
  "phone": "mobile",
  "phone number": "mobile",
  "contact number": "mobile",

  // Name
  "name": "name",
  "candidate name": "name",
  "candidate full name": "name",
  "candidates full name": "name",
  "student name": "name",
  "contact name": "name",

  // Email
  "email": "email",
  "email address": "email",

  // Optional NeoDove properties
  "stream": "stream",
  "ent given yes no": "ent_given",
  "exam name": "exam_name",
  "12th stream": "twelfth_stream",
  "location": "location",
  "higher studies yes no": "higher_studies",
  "giving students": "giving_students",
  "visit college": "visit_college",
  "college visit date": "college_visit_date",
  "mou": "mou",
  "college name": "college_name",

  "guardian s name": "guardian_name",
  "guardian name": "guardian_name",

  "compulsory elective 1":
    "compulsory_elective_1",

  "compulsory elective 2":
    "compulsory_elective_2",

  "compulsory elective 3":
    "compulsory_elective_3",

  "optional elective":
    "optional_elective",

  // These will work when corresponding
  // NeoDove custom paths are configured
  "school name": "school_name",
  "gender": "gender",
};


function getCellValue(cell) {
  if (!cell) return "";

  const value = cell.value;

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    if (value.text) {
      return String(value.text).trim();
    }

    if (value.result !== undefined) {
      return String(value.result).trim();
    }

    if (Array.isArray(value.richText)) {
      return value.richText
        .map((item) => item.text)
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}


function normalizeMobile(value) {
  if (!value) return null;

  let number =
    String(value).replace(/\D/g, "");

  // 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number = number.slice(1);
  }

  // 919876543210
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    number = number.slice(2);
  }

  if (number.length !== 10) {
    return null;
  }

  return number;
}


async function sendLeadToNeoDove(lead) {
  const response = await fetch(
    NEODOVE_IMPORT_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(lead),
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    success: response.ok,
    status: response.status,
    data,
  };
}

app.post(
  "/neodove/lead",

  async (req, res) => {
    try {

      // ----------------------------------------------
      // Verify NeoDove secret
      // ----------------------------------------------

      const webhookSecret =
        req.get(
          "x-webhook-secret"
        );


      if (
        !NEODOVE_WEBHOOK_SECRET ||
        webhookSecret !==
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


      // ----------------------------------------------
      // Log complete NeoDove payload
      // ----------------------------------------------

      console.log(
        "======================================"
      );

      console.log(
        "NEODOVE LEAD RECEIVED"
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


      // ----------------------------------------------
      // Get lead information
      // ----------------------------------------------

      const leadName =
        req.body.name ||
        req.body.lead_name ||
        req.body.contact_name ||
        null;


      const mobile =
        req.body.mobile ||
        req.body.phone ||
        req.body.phone_number ||
        req.body.contact_number ||
        null;


      // ----------------------------------------------
      // Get NeoDove assigned employee
      //
      // Supports multiple possible payload names.
      // ----------------------------------------------

      const agentName =
        req.body.agent_name ||
        req.body.agentName ||
        req.body.assigned_agent_name ||
        req.body.assignee_name ||
        req.body.agent?.name ||
        null;


      const agentNumber =
        req.body.agent_number ||
        req.body.agentNumber ||
        req.body.assigned_agent_number ||
        req.body.assignee_number ||
        req.body.agent?.number ||
        req.body.agent?.phone ||
        null;


      // ----------------------------------------------
      // Validate lead phone
      // ----------------------------------------------

      if (!mobile) {
        console.log(
          "⚠️ NeoDove payload has no mobile"
        );

        return res
          .status(200)
          .json({
            success: true,
            status:
              "ignored_missing_mobile",

            message:
              "Lead received but mobile number is missing",
          });
      }


      // ----------------------------------------------
      // Most important test:
      // Did NeoDove send assigned employee?
      // ----------------------------------------------

      if (!agentNumber) {

        console.log(
          "⚠️ NeoDove lead received but agent_number is missing"
        );

        console.log({
          leadName,
          mobile,
          agentName,
        });


        return res
          .status(200)
          .json({
            success: true,

            status:
              "received_agent_missing",

            message:
              "NeoDove lead received, but assigned agent number was not included",

            lead: {
              name:
                leadName,

              mobile,

              agent_name:
                agentName,

              agent_number:
                null,
            },
          });
      }


      // ----------------------------------------------
      // Create same lead in Callyzer
      // assigned to same NeoDove employee
      // ----------------------------------------------

      const callyzerResult =
        await createCallyzerLead(
          mobile,
          agentNumber,
          leadName
        );


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
          success: true,

          message:
            "NeoDove lead processed",

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
        "❌ NeoDove webhook error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,

          message:
            "NeoDove webhook processing failed",

          error:
            error.message,
        });
    }
  }
);


// ======================================================
// CALLYZER CALL WEBHOOK
//
// Keep this for Callyzer testing.
// ======================================================

app.post(
  "/callyzer/call-webhook",

  async (req, res) => {
    try {

      const signature =
        req.get(
          "x-callyzer-signature"
        );


      if (
        !CALLYZER_WEBHOOK_SECRET ||
        signature !==
          CALLYZER_WEBHOOK_SECRET
      ) {

        return res
          .status(401)
          .json({
            success: false,

            message:
              "Unauthorized Callyzer webhook",
          });
      }


      const payload =
        req.body;


      if (!Array.isArray(payload)) {

        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid Callyzer webhook payload",
          });
      }


      const results = [];

      const processed =
        new Set();


      // ----------------------------------------------
      // Employees
      // ----------------------------------------------

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


        // --------------------------------------------
        // Individual calls
        // --------------------------------------------

        for (
          const call
          of callLogs
        ) {

          console.log(
            "======================================"
          );

          console.log(
            "CALLYZER CALL EVENT"
          );

          console.log({
            employeeName,

            employeeNumber,

            clientName:
              call.client_name,

            clientNumber:
              call.client_number,

            callId:
              call.id,

            callType:
              call.call_type,

            duration:
              call.duration,

            recordingUrl:
              call.call_recording_url ||
              null,
          });

          console.log(
            "======================================"
          );


          // ------------------------------------------
          // Only outgoing calls
          // ------------------------------------------

          if (
            String(
              call.call_type || ""
            )
              .toLowerCase()
              .trim() !==
            "outgoing"
          ) {
            continue;
          }


          const client =
            formatIndianPhone(
              call.client_number
            );


          const employeePhone =
            formatIndianPhone(
              employeeNumber
            );


          if (
            !client ||
            !employeePhone
          ) {

            console.log(
              "Skipping invalid/test number"
            );

            continue;
          }


          // Avoid same lead more than once
          // in same webhook payload

          const key =
            `${employeePhone}:${client}`;


          if (
            processed.has(key)
          ) {
            continue;
          }


          processed.add(key);


          const leadResult =
            await createCallyzerLead(
              call.client_number,

              employeeNumber,

              call.client_name
            );


          results.push({
            clientNumber:
              client,

            employeeName,

            employeeNumber:
              employeePhone,

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
        }
      }


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
        "❌ Callyzer webhook error:",
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
app.get("/upload", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>NeoDove Lead Import</title>

  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f6f8;
      padding: 40px;
    }

    .box {
      max-width: 500px;
      margin: auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 5px 20px rgba(0,0,0,.08);
    }

    h2 {
      margin-top: 0;
    }

    input {
      display: block;
      width: 100%;
      margin: 15px 0;
      padding: 10px;
      box-sizing: border-box;
    }

    button {
      width: 100%;
      padding: 12px;
      background: #111;
      color: white;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }

    .note {
      font-size: 13px;
      color: #666;
      margin-top: 15px;
    }
  </style>
</head>

<body>

<div class="box">

  <h2>Upload Leads</h2>

  <form
    action="/upload-leads"
    method="POST"
    enctype="multipart/form-data"
  >

    <label>Excel File</label>

    <input
      type="file"
      name="excel"
      accept=".xlsx"
      required
    />

    <label>
      Maximum rows to test
    </label>

    <input
      type="number"
      name="limit"
      placeholder="Example: 2"
      min="1"
    />

    <button type="submit">
      Upload to NeoDove
    </button>

  </form>

  <div class="note">
    Only Mobile Number is mandatory.
    Leave Maximum Rows blank later to import
    the entire Excel file.
  </div>

</div>

</body>
</html>
  `);
});

app.post(
  "/upload-leads",

  upload.single("excel"),

  async (req, res) => {
    try {

      if (!NEODOVE_IMPORT_URL) {
        return res.status(500).json({
          success: false,
          message:
            "NEODOVE_IMPORT_URL is not configured",
        });
      }


      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            "Please upload an Excel file",
        });
      }


      const workbook =
        new ExcelJS.Workbook();


      await workbook.xlsx.load(
        req.file.buffer
      );


      const worksheet =
        workbook.worksheets[0];


      if (!worksheet) {
        return res.status(400).json({
          success: false,
          message:
            "Excel file has no worksheet",
        });
      }


      // --------------------------------------------
      // Read headers
      // --------------------------------------------

      const headerRow =
        worksheet.getRow(1);


      const columns = {};


      headerRow.eachCell(
        { includeEmpty: false },

        (cell, columnNumber) => {

          const originalHeader =
            getCellValue(cell);


          const normalized =
            normalizeHeader(
              originalHeader
            );


          const neodoveField =
            EXCEL_FIELD_MAP[
              normalized
            ];


          if (neodoveField) {
            columns[columnNumber] =
              neodoveField;
          }
        }
      );


      // --------------------------------------------
      // Mobile column must exist
      // --------------------------------------------

      const hasMobile =
        Object.values(
          columns
        ).includes("mobile");


      if (!hasMobile) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Could not find a mobile/phone number column in the Excel file",
          });
      }


      const limit =
        req.body.limit
          ? Number(req.body.limit)
          : null;


      const results = [];

      let sent = 0;
      let skipped = 0;
      let failed = 0;


      // --------------------------------------------
      // Process rows
      // --------------------------------------------

      for (
        let rowNumber = 2;
        rowNumber <= worksheet.rowCount;
        rowNumber++
      ) {

        if (
          limit &&
          sent >= limit
        ) {
          break;
        }


        const row =
          worksheet.getRow(
            rowNumber
          );


        const lead = {};


        // ------------------------------------------
        // Only use fields that actually exist
        // ------------------------------------------

        for (
          const [
            columnNumber,
            fieldName,
          ] of Object.entries(
            columns
          )
        ) {

          const value =
            getCellValue(
              row.getCell(
                Number(
                  columnNumber
                )
              )
            );


          // Blank value = don't send field
          if (!value) {
            continue;
          }


          lead[fieldName] =
            value;
        }


        // ------------------------------------------
        // Mobile is mandatory
        // ------------------------------------------

        const mobile =
          normalizeMobile(
            lead.mobile
          );


        if (!mobile) {

          skipped++;

          results.push({
            row: rowNumber,
            status: "skipped",
            reason:
              "Mobile number missing or invalid",
          });

          continue;
        }


        lead.mobile =
          mobile;


        // Name is optional.
        // If missing, don't send it.
        if (
          lead.name &&
          !String(
            lead.name
          ).trim()
        ) {
          delete lead.name;
        }


        try {

          console.log(
            `Sending Excel row ${rowNumber} to NeoDove`
          );

          console.log(lead);


          const result =
            await sendLeadToNeoDove(
              lead
            );


          if (result.success) {

            sent++;

            results.push({
              row: rowNumber,
              mobile,
              name:
                lead.name || "",
              status: "sent",
            });

          } else {

            failed++;

            results.push({
              row: rowNumber,
              mobile,
              status: "failed",
              response:
                result.data,
            });
          }


          /*
            Important:

            We intentionally send leads slowly.

            NeoDove creates the lead
            → assigns employee
            → sends webhook
            → Render calls Callyzer.

            Callyzer Sandbox has a rate limit,
            so do not blast all rows at once.
          */

          await sleep(1500);

        } catch (error) {

          failed++;

          results.push({
            row: rowNumber,
            mobile,
            status: "failed",
            error:
              error.message,
          });
        }
      }


      return res.json({
        success: true,

        message:
          "Excel processing completed",

        file:
          req.file.originalname,

        worksheet:
          worksheet.name,

        sent,

        skipped,

        failed,

        results,
      });


    } catch (error) {

      console.error(
        "Excel upload error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,

          message:
            "Excel import failed",

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// 404
// IMPORTANT: KEEP THIS LAST
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
      "======================================"
    );
  }
);