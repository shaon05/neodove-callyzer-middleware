import "dotenv/config";
import express from "express";
import helmet from "helmet";

const app = express();


// ======================================================
// Middleware
// ======================================================

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


// ======================================================
// Callyzer Dynamic Field IDs
//
// These are your CURRENT SANDBOX field IDs.
//
// Later, production Callyzer may generate different IDs.
// Environment variables let us replace them without
// changing server.js.
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
// Validate Required Environment Variables
// ======================================================

if (!CALLYZER_API_KEY) {
  console.error(
    "Missing CALLYZER_API_KEY environment variable"
  );
}

if (!CALLYZER_BASE_URL) {
  console.error(
    "Missing CALLYZER_BASE_URL environment variable"
  );
}

if (!NEODOVE_WEBHOOK_SECRET) {
  console.error(
    "Missing NEODOVE_WEBHOOK_SECRET environment variable"
  );
}


// ======================================================
// Format Indian Phone Number
//
// 9932154780
//      ↓
// 91-9932154780
//
// 919932154780
//      ↓
// 91-9932154780
// ======================================================

function formatPhoneNumber(phone) {
  if (!phone) {
    return null;
  }

  const number = String(phone).replace(/\D/g, "");

  // Indian 10 digit number
  if (number.length === 10) {
    return `91-${number}`;
  }

  // Already includes country code
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    return `91-${number.slice(2)}`;
  }

  return String(phone);
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
// NeoDove Lead Webhook
// ======================================================

app.post(
  "/neodove/lead",

  async (req, res) => {
    try {

      // ==================================================
      // Verify NeoDove Webhook Secret
      // ==================================================

      const incomingSecret =
        req.get("x-webhook-secret");

      if (
        !NEODOVE_WEBHOOK_SECRET ||
        incomingSecret !== NEODOVE_WEBHOOK_SECRET
      ) {
        console.warn(
          "Rejected unauthorized webhook request"
        );

        return res.status(401).json({
          success: false,
          message:
            "Unauthorized webhook request",
        });
      }


      // ==================================================
      // NeoDove Payload
      // ==================================================

      const body = req.body;

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid NeoDove request body",
        });
      }


      // ==================================================
      // Extract NeoDove Lead Data
      // ==================================================

      const leadId =
        body.lead_id;

      const leadName =
        body.name;

      const leadNumber =
        body.mobile;

      const leadEmail =
        body.email;


      // Campaign

      const campaignId =
        body.campaign_id;

      const campaignName =
        body.campaign_name;


      // Lead status

      const leadStage =
        body.lead_stage_name;

      const leadStatus =
        body.lead_status_name;


      // Assigned NeoDove Agent

      const agentName =
        body.agent_name;

      const agentNumber =
        body.agent_number;

      const agentEmail =
        body.agent_email;


      // Other NeoDove information

      const leadTag =
        body.lead_tag_name;

      const disposeRemark =
        body.dispose_remark;

      const creationDate =
        body.lead_creation_date;

      const creationTime =
        body.lead_creation_time;

      const otherProperties =
        body.other_properties;

      const customProperties =
        body.contact_custom_properties;


      // ==================================================
      // Validate Lead
      // ==================================================

      if (
        !leadName ||
        !leadNumber
      ) {
        return res.status(400).json({
          success: false,

          message:
            "NeoDove lead name and mobile number are required",
        });
      }


      // ==================================================
      // Validate Agent
      // ==================================================

      if (!agentNumber) {
        return res.status(400).json({
          success: false,

          message:
            "NeoDove agent number is required",
        });
      }


      // ==================================================
      // Format Phone Numbers
      // ==================================================

      const formattedLeadNumber =
        formatPhoneNumber(
          leadNumber
        );

      const formattedAgentNumber =
        formatPhoneNumber(
          agentNumber
        );


      // ==================================================
      // Build Callyzer Dynamic Fields
      // ==================================================

      const dynamicFields = {};


      if (
        leadId !== undefined &&
        leadId !== null
      ) {
        dynamicFields[
          CALLYZER_FIELDS.NEODOVE_LEAD_ID
        ] = String(leadId);
      }


      if (campaignName) {
        dynamicFields[
          CALLYZER_FIELDS.CAMPAIGN_NAME
        ] = String(campaignName);
      }


      if (leadStatus) {
        dynamicFields[
          CALLYZER_FIELDS.LEAD_STATUS
        ] = String(leadStatus);
      }


      if (agentName) {
        dynamicFields[
          CALLYZER_FIELDS.AGENT_NAME
        ] = String(agentName);
      }


      if (agentNumber) {
        dynamicFields[
          CALLYZER_FIELDS.AGENT_NUMBER
        ] = String(agentNumber);
      }


      // ==================================================
      // Build Callyzer Lead
      // ==================================================

      const callyzerPayload = {
        first_name:
          String(leadName),

        contact_numbers: [
          formattedLeadNumber,
        ],

        assignment: {
          strategy:
            "Assign to All Selected",

          emp_numbers: [
            formattedAgentNumber,
          ],
        },

        fields:
          dynamicFields,

        is_map_existing_call_logs:
          true,
      };


      // ==================================================
      // Add Email If Available
      // ==================================================

      if (leadEmail) {
        callyzerPayload.email =
          String(leadEmail);
      }


      // ==================================================
      // Useful Server Log
      //
      // Don't print API keys or webhook secrets.
      // ==================================================

      console.log(
        "NeoDove lead received:",
        {
          leadId,
          leadName,
          campaignName,
          leadStatus,
          agentName,
        }
      );


      console.log(
        "Sending lead to Callyzer:",
        {
          leadId,
          agentName,
          dynamicEmployeeAssignment: true,
        }
      );


      // ==================================================
      // Send Lead to Callyzer
      // ==================================================

      const callyzerResponse =
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
                callyzerPayload
              ),
          }
        );


      // ==================================================
      // Read Callyzer Response
      // ==================================================

      const responseText =
        await callyzerResponse.text();


      let callyzerData;


      try {
        callyzerData =
          JSON.parse(
            responseText
          );
      } catch {
        callyzerData = {
          raw_response:
            responseText,
        };
      }


      // ==================================================
      // Callyzer Error
      // ==================================================

      if (
        !callyzerResponse.ok
      ) {
        console.error(
          "Callyzer rejected lead:",
          {
            status:
              callyzerResponse.status,

            leadId,

            response:
              callyzerData,
          }
        );


        return res
          .status(
            callyzerResponse.status
          )
          .json({
            success: false,

            message:
              "Callyzer rejected the lead",

            callyzer:
              callyzerData,
          });
      }


      // ==================================================
      // Success
      // ==================================================

      console.log(
        "Lead successfully sent to Callyzer:",
        {
          leadId,
          leadName,
          agentName,
        }
      );


      return res
        .status(200)
        .json({
          success: true,

          message:
            "Lead successfully sent to Callyzer",

          mapping: {
            neodove_lead_id:
              leadId,

            lead_name:
              leadName,

            lead_number:
              formattedLeadNumber,

            email:
              leadEmail,

            campaign_id:
              campaignId,

            campaign_name:
              campaignName,

            lead_stage:
              leadStage,

            lead_status:
              leadStatus,

            agent_name:
              agentName,

            agent_number:
              formattedAgentNumber,

            agent_email:
              agentEmail,

            lead_tag:
              leadTag,

            dispose_remark:
              disposeRemark,

            created_date:
              creationDate,

            created_time:
              creationTime,

            other_properties:
              otherProperties,

            custom_properties:
              customProperties,
          },

          callyzer:
            callyzerData,
        });

    } catch (error) {

      console.error(
        "Middleware error:",
        error
      );


      return res
        .status(500)
        .json({
          success: false,

          message:
            "Middleware error",

          error:
            error.message,
        });
    }
  }
);

app.post("/neodove/global-test", (req, res) => {
  try {
    const incomingSecret = req.get("x-webhook-secret");

    if (
      !process.env.NEODOVE_WEBHOOK_SECRET ||
      incomingSecret !== process.env.NEODOVE_WEBHOOK_SECRET
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized webhook request",
      });
    }

    console.log("======================================");
    console.log("NEODOVE GLOBAL WEBHOOK PAYLOAD");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("======================================");

    return res.status(200).json({
      success: true,
      message: "Global NeoDove webhook received",
    });
  } catch (error) {
    console.error("Global webhook error:", error);

    return res.status(500).json({
      success: false,
      message: "Webhook error",
    });
  }
});
// ======================================================
// 404 Handler
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
//
// 0.0.0.0 is important for Render.
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