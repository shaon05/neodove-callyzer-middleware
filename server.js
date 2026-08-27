import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 5000;

const CALLYZER_BASE_URL = process.env.CALLYZER_BASE_URL;
const CALLYZER_API_KEY = process.env.CALLYZER_API_KEY;
const NEODOVE_WEBHOOK_SECRET = process.env.NEODOVE_WEBHOOK_SECRET;

const ASSIGNMENT_STRATEGY =
  process.env.CALLYZER_ASSIGNMENT_STRATEGY || "Round Robin";


// -----------------------------------------------------
// Basic validation
// -----------------------------------------------------

if (!CALLYZER_BASE_URL) {
  throw new Error("CALLYZER_BASE_URL is missing");
}

if (!CALLYZER_API_KEY) {
  throw new Error("CALLYZER_API_KEY is missing");
}

if (!NEODOVE_WEBHOOK_SECRET) {
  throw new Error("NEODOVE_WEBHOOK_SECRET is missing");
}


// -----------------------------------------------------
// Health endpoint
// -----------------------------------------------------

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "NeoDove → Callyzer middleware is running",
    environment: CALLYZER_BASE_URL.includes("sandbox")
      ? "sandbox"
      : "production"
  });
});


// -----------------------------------------------------
// Verify NeoDove webhook
// -----------------------------------------------------

function verifyNeoDove(req, res, next) {

  const secret = req.headers["x-webhook-secret"];

  if (!secret || secret !== NEODOVE_WEBHOOK_SECRET) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized webhook request"
    });

  }

  next();
}


// -----------------------------------------------------
// Extract lead data from NeoDove
// -----------------------------------------------------

function extractLead(body) {

  const firstName =
    body.first_name ||
    body.name ||
    body.lead_name ||
    body.leadName;

  const phone =
    body.contact_numbers ||
    body.mobile ||
    body.phone ||
    body.lead_number ||
    body.leadNumber;

  return {
    firstName,
    phone
  };
}


// -----------------------------------------------------
// Convert phone to Callyzer array
// -----------------------------------------------------

function normalizePhone(phone) {

  if (Array.isArray(phone)) {
    return phone.map(number => String(number).trim());
  }

  return [String(phone).trim()];
}


// -----------------------------------------------------
// Send lead to Callyzer
// -----------------------------------------------------

async function sendToCallyzer({
  firstName,
  phone,
  leadStatus
}) {

  const payload = {

    first_name: firstName,

    contact_numbers: normalizePhone(phone),

    assignment: {
      strategy: ASSIGNMENT_STRATEGY
    }

  };


  // Only add status when provided
  if (leadStatus) {
    payload.lead_status = leadStatus;
  }


  console.log(
    "Sending payload to Callyzer:",
    JSON.stringify(payload, null, 2)
  );


  const response = await axios.post(
    `${CALLYZER_BASE_URL}/lead/save`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${CALLYZER_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );


  return response.data;
}


// -----------------------------------------------------
// Lead Created
// -----------------------------------------------------

app.post(
  "/webhooks/neodove/lead-created",
  verifyNeoDove,
  async (req, res) => {

    try {

      console.log("Lead Created webhook received");

      console.log(
        JSON.stringify(req.body, null, 2)
      );


      const { firstName, phone } =
        extractLead(req.body);


      if (!firstName) {

        return res.status(400).json({
          success: false,
          message: "Lead name is missing"
        });

      }


      if (!phone) {

        return res.status(400).json({
          success: false,
          message: "Lead phone number is missing"
        });

      }


      const result = await sendToCallyzer({
        firstName,
        phone
      });


      return res.status(200).json({
        success: true,
        event: "LEAD_CREATED",
        message: "Lead sent to Callyzer",
        callyzer: result
      });


    } catch (error) {

      handleError(error, res);

    }

  }
);


// -----------------------------------------------------
// Call Connected
// -----------------------------------------------------

app.post(
  "/webhooks/neodove/call-connected",
  verifyNeoDove,
  async (req, res) => {

    try {

      console.log("Call Connected webhook received");

      console.log(
        JSON.stringify(req.body, null, 2)
      );


      const { firstName, phone } =
        extractLead(req.body);


      if (!firstName || !phone) {

        return res.status(400).json({
          success: false,
          message: "Lead name and phone are required"
        });

      }


      const result = await sendToCallyzer({

        firstName,

        phone,

        // Change this to an actual
        // active Callyzer lead status if needed
        leadStatus: undefined

      });


      return res.status(200).json({
        success: true,
        event: "CALL_CONNECTED",
        message:
          "Connected call lead synced to Callyzer",
        callyzer: result
      });


    } catch (error) {

      handleError(error, res);

    }

  }
);


// -----------------------------------------------------
// Call Not Connected
// -----------------------------------------------------

app.post(
  "/webhooks/neodove/call-not-connected",
  verifyNeoDove,
  async (req, res) => {

    try {

      console.log("Call Not Connected webhook received");

      console.log(
        JSON.stringify(req.body, null, 2)
      );


      const { firstName, phone } =
        extractLead(req.body);


      if (!firstName || !phone) {

        return res.status(400).json({
          success: false,
          message: "Lead name and phone are required"
        });

      }


      const result = await sendToCallyzer({

        firstName,

        phone,

        // Set an actual Callyzer status later
        leadStatus: undefined

      });


      return res.status(200).json({
        success: true,
        event: "CALL_NOT_CONNECTED",
        message:
          "Not-connected call lead synced to Callyzer",
        callyzer: result
      });


    } catch (error) {

      handleError(error, res);

    }

  }
);


// -----------------------------------------------------
// Error handler
// -----------------------------------------------------

function handleError(error, res) {

  if (error.response) {

    console.error(
      "Callyzer API error:",
      error.response.status,
      error.response.data
    );


    return res
      .status(error.response.status)
      .json({

        success: false,

        message:
          "Callyzer rejected the request",

        callyzer: error.response.data

      });

  }


  console.error(
    "Middleware error:",
    error.message
  );


  return res.status(500).json({

    success: false,

    message:
      "Middleware internal server error",

    error: error.message

  });

}


// -----------------------------------------------------
// 404
// -----------------------------------------------------

app.use((req, res) => {

  res.status(404).json({
    success: false,
    message: "Route not found"
  });

});


// -----------------------------------------------------
// Start server
// -----------------------------------------------------

app.listen(PORT, () => {

  console.log(
    `NeoDove → Callyzer middleware running on port ${PORT}`
  );

});