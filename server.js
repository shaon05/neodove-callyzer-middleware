import "dotenv/config";
import express from "express";
import helmet from "helmet";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const CALLYZER_API_KEY =
  process.env.CALLYZER_API_KEY;

const CALLYZER_BASE_URL =
  process.env.CALLYZER_BASE_URL;

const CALLYZER_WEBHOOK_SECRET =
  process.env.CALLYZER_WEBHOOK_SECRET;


// ======================================================
// Phone formatter
// ======================================================

function formatIndianPhone(phone) {
  if (!phone) return null;

  let number =
    String(phone).replace(/\D/g, "");

  // 09876543210
  if (
    number.length === 11 &&
    number.startsWith("0")
  ) {
    number = number.slice(1);
  }

  // 9876543210
  if (number.length === 10) {
    return `91-${number}`;
  }

  // 919876543210
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    return `91-${number.slice(2)}`;
  }

  return null;
}


// ======================================================
// Read response safely
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
// Check duplicate lead
// ======================================================

function isDuplicateLead(data) {
  const text =
    JSON.stringify(data).toLowerCase();

  return (
    text.includes("already exists") ||
    text.includes("already exist")
  );
}


// ======================================================
// Create Callyzer Lead
// ======================================================

async function createCallyzerLead(
  clientNumber,
  employeeNumber
) {
  const client =
    formatIndianPhone(clientNumber);

  const employee =
    formatIndianPhone(employeeNumber);

  if (!client || !employee) {
    return {
      success: false,
      status: "invalid_number",
    };
  }

  const localNumber =
    client.split("-")[1];


  const payload = {
    // We don't need customer's real name.
    // Phone number becomes the lead name.
    first_name: localNumber,

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

    // IMPORTANT:
    // Map calls which already exist
    // for this customer number.
    is_map_existing_call_logs:
      true,
  };


  console.log(
    "Creating Callyzer lead:",
    {
      client,
      employee,
    }
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
// Health Check
// ======================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "Callyzer call middleware is running",
  });
});


// ======================================================
// CALL EVENT → RENDER → CREATE CALLYZER LEAD
// ======================================================

app.post(
  "/callyzer/call-webhook",

  async (req, res) => {
    try {

      // ------------------------------------------------
      // Verify webhook secret
      // ------------------------------------------------

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


      // ------------------------------------------------
      // Callyzer sends array
      // ------------------------------------------------

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


      // ------------------------------------------------
      // Employees
      // ------------------------------------------------

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


        // ----------------------------------------------
        // Calls
        // ----------------------------------------------

        for (
          const call
          of callLogs
        ) {

          const clientNumber =
            call.client_number;


          console.log(
            "======================================"
          );

          console.log(
            "CALL EVENT RECEIVED"
          );

          console.log({
            employeeName,
            employeeNumber,

            clientNumber,

            callId:
              call.id,

            callType:
              call.call_type,

            duration:
              call.duration,

            callDate:
              call.call_date,

            callTime:
              call.call_time,

            recordingUrl:
              call.call_recording_url ||
              null,
          });

          console.log(
            "======================================"
          );


          // --------------------------------------------
          // Only outgoing calls
          // --------------------------------------------

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


          // --------------------------------------------
          // Validate numbers
          // --------------------------------------------

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
              "Skipping invalid/test numbers"
            );

            continue;
          }


          // --------------------------------------------
          // Don't process same number twice
          // in one webhook request
          // --------------------------------------------

          const key =
            `${formattedEmployee}:${formattedClient}`;


          if (
            processed.has(key)
          ) {
            continue;
          }


          processed.add(key);


          // --------------------------------------------
          // Create Callyzer lead
          // --------------------------------------------

          const leadResult =
            await createCallyzerLead(
              clientNumber,
              employeeNumber
            );


          results.push({
            employeeName,

            employeeNumber:
              formattedEmployee,

            clientNumber:
              formattedClient,

            callId:
              call.id,

            duration:
              call.duration,

            recordingUrl:
              call.call_recording_url ||
              null,

            lead:
              leadResult,
          });


          if (
            leadResult.status ===
            "created"
          ) {
            console.log(
              `✅ Lead created: ${formattedClient}`
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
              `❌ Lead creation failed: ${formattedClient}`,
              leadResult
            );
          }
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
        "Webhook error:",
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
);


// ======================================================
// 404
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message:
      "Route not found",
  });
});


// ======================================================
// Server
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "======================================"
    );

    console.log(
      "Callyzer call middleware running"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      "======================================"
    );
  }
);