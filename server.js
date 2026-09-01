import "dotenv/config";
import express from "express";
import helmet from "helmet";

const app = express();

app.use(helmet());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CALLYZER_API_KEY = process.env.CALLYZER_API_KEY;
const CALLYZER_BASE_URL = process.env.CALLYZER_BASE_URL;


// ==========================================
// Callyzer Custom Field IDs
// ==========================================

const CALLYZER_FIELDS = {
  NEODOVE_LEAD_ID: "InputBox1788251139587",
  CAMPAIGN_NAME: "InputBox1788251139595",
  LEAD_STATUS: "InputBox1788251139603",
  AGENT_NAME: "InputBox1788251139614",
  AGENT_NUMBER: "InputBox1788251139623",
};


// ==========================================
// Format Indian Phone Number
// ==========================================

function formatPhoneNumber(phone) {
  if (!phone) return null;

  const number = String(phone).replace(/\D/g, "");

  // Example: 9932154780
  if (number.length === 10) {
    return `91-${number}`;
  }

  // Example: 919932154780
  if (
    number.length === 12 &&
    number.startsWith("91")
  ) {
    return `91-${number.slice(2)}`;
  }

  return phone;
}


// ==========================================
// Health Check
// ==========================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NeoDove → Callyzer middleware is running",
    environment: "sandbox",
  });
});


// ==========================================
// NeoDove Lead Webhook
// ==========================================

app.post("/neodove/lead", async (req, res) => {
  try {
    const body = req.body;

    console.log("\n==================================");
    console.log("Received NeoDove Lead");
    console.log("==================================");

    console.log(
      JSON.stringify(body, null, 2)
    );


    // ======================================
    // Validate Body
    // ======================================

    if (
      !body ||
      typeof body !== "object"
    ) {
      return res.status(400).json({
        success: false,
        message: "Request body is required",
      });
    }


    // ======================================
    // Extract NeoDove Fields
    // ======================================

    const leadName = body.name;
    const leadNumber = body.mobile;
    const leadEmail = body.email;

    const leadId = body.lead_id;

    const campaignId = body.campaign_id;
    const campaignName = body.campaign_name;

    const leadStage = body.lead_stage_name;
    const leadStatus = body.lead_status_name;

    const agentName = body.agent_name;
    const agentNumber = body.agent_number;
    const agentEmail = body.agent_email;

    const leadTag = body.lead_tag_name;
    const disposeRemark = body.dispose_remark;

    const creationDate =
      body.lead_creation_date;

    const creationTime =
      body.lead_creation_time;

    const otherProperties =
      body.other_properties;


    // ======================================
    // Validate Lead
    // ======================================

    if (!leadName || !leadNumber) {
      return res.status(400).json({
        success: false,
        message:
          "NeoDove lead name and mobile number are required",
      });
    }


    // ======================================
    // Validate Agent
    // ======================================

    if (!agentNumber) {
      return res.status(400).json({
        success: false,
        message:
          "NeoDove agent number is required",
      });
    }


    // ======================================
    // Format Numbers
    // ======================================

    const formattedLeadNumber =
      formatPhoneNumber(leadNumber);

    const formattedAgentNumber =
      formatPhoneNumber(agentNumber);


    // ======================================
    // Build Dynamic Fields
    // ======================================

    const dynamicFields = {};

    if (leadId !== undefined && leadId !== null) {
      dynamicFields[
        CALLYZER_FIELDS.NEODOVE_LEAD_ID
      ] = String(leadId);
    }

    if (campaignName) {
      dynamicFields[
        CALLYZER_FIELDS.CAMPAIGN_NAME
      ] = campaignName;
    }

    if (leadStatus) {
      dynamicFields[
        CALLYZER_FIELDS.LEAD_STATUS
      ] = leadStatus;
    }

    if (agentName) {
      dynamicFields[
        CALLYZER_FIELDS.AGENT_NAME
      ] = agentName;
    }

    if (agentNumber) {
      dynamicFields[
        CALLYZER_FIELDS.AGENT_NUMBER
      ] = String(agentNumber);
    }


    // ======================================
    // Build Callyzer Payload
    // ======================================

    const callyzerPayload = {
      first_name: leadName,

      contact_numbers: [
        formattedLeadNumber,
      ],

      assignment: {
        strategy: "Assign to All Selected",

        emp_numbers: [
          formattedAgentNumber,
        ],
      },

      fields: dynamicFields,

      is_map_existing_call_logs: true,
    };


    // Add email only when available
    if (leadEmail) {
      callyzerPayload.email = leadEmail;
    }


    // ======================================
    // Logs
    // ======================================

    console.log("\nNeoDove → Callyzer Mapping:");

    console.log({
      leadName,
      leadNumber: formattedLeadNumber,
      leadEmail,

      leadId,

      campaignName,

      leadStatus,

      agentName,
      agentNumber: formattedAgentNumber,
    });


    console.log("\nCallyzer Payload:");

    console.log(
      JSON.stringify(
        callyzerPayload,
        null,
        2
      )
    );


    // ======================================
    // Send Lead To Callyzer
    // ======================================

    const response = await fetch(
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

        body: JSON.stringify(
          callyzerPayload
        ),
      }
    );


    // ======================================
    // Read Callyzer Response
    // ======================================

    const responseText =
      await response.text();

    let callyzerData;

    try {
      callyzerData =
        JSON.parse(responseText);
    } catch {
      callyzerData = {
        raw_response: responseText,
      };
    }


    // ======================================
    // Callyzer Error
    // ======================================

    if (!response.ok) {
      console.error(
        "\nCallyzer rejected lead:"
      );

      console.error(
        callyzerData
      );

      return res
        .status(response.status)
        .json({
          success: false,

          message:
            "Callyzer rejected the lead",

          callyzer:
            callyzerData,
        });
    }


    // ======================================
    // Success
    // ======================================

    console.log(
      "\n✅ Lead successfully sent to Callyzer"
    );


    return res.json({
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
      },

      callyzer:
        callyzerData,
    });

  } catch (error) {

    console.error(
      "\nMiddleware Error:"
    );

    console.error(error);

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
});


// ==========================================
// 404 Handler
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});


// ==========================================
// Start Server
// ==========================================

app.listen(PORT, () => {

  console.log(
    "======================================"
  );

  console.log(
    `NeoDove → Callyzer middleware running`
  );

  console.log(
    `http://localhost:${PORT}`
  );

  console.log(
    "======================================"
  );
});