
require("dotenv").config();

const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const supabase = require("./supabase");

const app = express();

app.use(cors());
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "convenor-mpesa-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        maxAge: 8 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, "public"), {
    index: false
}));
app.get("/", (req, res) => {
    if (req.session.user) {
        return res.redirect("/dashboard");
    }

    res.redirect("/login.html");
});

// LOGIN
app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required"
            });
        }

        const { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

if (userError) {
    console.error("Login database error:", userError);
    return res.status(500).json({
        success: false,
        message: "Database error"
    });
}

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        req.session.user = {
            id: user.id,
            username: user.username
        };

        res.json({
            success: true,
            message: "Login successful"
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

// LOGOUT
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({
            success: true
        });
    });
});

// CHECK LOGIN
app.get("/api/session", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        user: req.session.user
    });
});

app.get("/api/mpesa/auth", async (req, res) => {
    try {
        const credentials = Buffer.from(
            `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
        ).toString("base64");

        const response = await axios.get(
            "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );

        res.json(response.data);

    } catch (error) {
        console.error(error.response?.data || error.message);

        res.status(500).json({
            error: "Failed to authenticate with M-Pesa",
            details: error.response?.data || error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
function requireLogin(req, res, next) {
    if (req.session.user) {
        return next();
    }

    return res.status(401).json({
        success: false,
        message: "Authentication required"
    });
}
app.post("/api/mpesa/stkpush", requireLogin, async (req, res) => {
    try {
       const {
    clientName,
    phone,
    amount,
    paymentCategory,
    insuranceType,
    registrationNumber,
    policyNumber
} = req.body;

       if (!phone || !amount || !clientName || !paymentCategory) {
    return res.status(400).json({
        error: "Client name, phone number, amount and payment purpose are required"
    });
}

        // Get access token
        const credentials = Buffer.from(
            `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
        ).toString("base64");

        const authResponse = await axios.get(
            "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );

        const accessToken = authResponse.data.access_token;

        // Generate timestamp
        const timestamp = moment().format("YYYYMMDDHHmmss");

        // Sandbox credentials
        const shortCode = process.env.DARAJA_SHORTCODE;
        const passkey = process.env.DARAJA_PASSKEY;

        // Generate STK password
        const password = Buffer.from(
            `${shortCode}${passkey}${timestamp}`
        ).toString("base64");

        // Send STK Push
        const stkResponse = await axios.post(
            "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            {
                BusinessShortCode: shortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: Number(amount),
                PartyA: phone,
                PartyB: shortCode,
                PhoneNumber: phone,

               CallBackURL:
    "https://valentine-extensions-pottery-joining.trycloudflare.com/api/mpesa/callback",
                AccountReference: "Convenor",
                TransactionDesc: "Convenor Insurance Payment"
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        // Only the actual Daraja response data
        const stkData = stkResponse.data;

        console.log("STK RESPONSE:", stkData);

        // Save transaction as PENDING
  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
        merchant_request_id: stkData.MerchantRequestID,
        checkout_request_id: stkData.CheckoutRequestID,
        phone: phone,
        amount: amount,
        status: "PENDING",
        result_description: stkData.ResponseDescription,
        client_name: clientName,
        payment_category: paymentCategory,
        insurance_type: insuranceType || null,
        registration_number: registrationNumber || null,
        policy_number: policyNumber || null
    });

if (paymentError) {
    console.error("Payment database error:", paymentError);

    return res.status(500).json({
        success: false,
        message: "STK Push was sent but payment could not be saved."
    });
}
        console.log("💾 STK request saved as PENDING.");

        // Send ONLY ONE response to frontend
        res.json(stkData);

    } catch (error) {

        console.error(
            "STK ERROR:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "STK Push failed",
            details: error.response?.data || error.message
        });
    }
});
app.get("/api/mpesa/query/:checkoutRequestId", requireLogin, async (req, res) => {
    try {
        const checkoutRequestId = req.params.checkoutRequestId;

        // Get access token
        const credentials = Buffer.from(
            `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
        ).toString("base64");

        const authResponse = await axios.get(
            "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );

        const accessToken = authResponse.data.access_token;

        const timestamp = moment().format("YYYYMMDDHHmmss");

        const shortCode = process.env.DARAJA_SHORTCODE;
        const passkey = process.env.DARAJA_PASSKEY;

        const password = Buffer.from(
            `${shortCode}${passkey}${timestamp}`
        ).toString("base64");

        const queryResponse = await axios.post(
            "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query",
            {
                BusinessShortCode: shortCode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestId
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("STK QUERY RESPONSE:", queryResponse.data);

        res.json(queryResponse.data);

    } catch (error) {
        console.error(
            "STK QUERY ERROR:",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            error: "STK Query failed",
            details: error.response?.data || error.message
        });
    }
});
app.post("/api/mpesa/callback", async (req, res) => {
    console.log("=================================");
    console.log("M-PESA CALLBACK RECEIVED");
    console.log("=================================");

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
        console.log("Invalid M-Pesa callback received:");
        console.log(JSON.stringify(req.body, null, 2));

        return res.json({
            ResultCode: 1,
            ResultDesc: "Invalid callback"
        });
    }

    console.log("MerchantRequestID:", callback.MerchantRequestID);
    console.log("CheckoutRequestID:", callback.CheckoutRequestID);
    console.log("ResultCode:", callback.ResultCode);
    console.log("ResultDesc:", callback.ResultDesc);

    // Successful payment
    if (callback.ResultCode === 0) {

        const metadata = callback.CallbackMetadata?.Item || [];

        const getMetadata = (name) => {
            const item = metadata.find(item => item.Name === name);
            return item?.Value;
        };

        const amount = getMetadata("Amount");
        const receipt = getMetadata("MpesaReceiptNumber");
        const transactionDate = String(
            getMetadata("TransactionDate") || ""
        );
        const phoneNumber = String(
            getMetadata("PhoneNumber") || ""
        ).replace(".0", "");

        const { error: updateError } = await supabase
            .from("payments")
            .update({
                status: "SUCCESS",
                mpesa_receipt: receipt || null,
                transaction_date: transactionDate,
                result_description: callback.ResultDesc
            })
            .eq(
                "checkout_request_id",
                callback.CheckoutRequestID
            );

        if (updateError) {
            console.error("Callback database error:", updateError);
        } else {
            console.log("💾 Payment updated to SUCCESS.");
        }

        console.log("=================================");
        console.log("💰 PAYMENT SUCCESSFUL");
        console.log("=================================");
        console.log("Amount:", amount);
        console.log("M-Pesa Receipt:", receipt);
        console.log("Phone:", phoneNumber);
        console.log("Transaction Date:", transactionDate);
    }

    // Failed / cancelled payment
    else {

        const { error: updateError } = await supabase
            .from("payments")
            .update({
                status: "FAILED",
                result_description: callback.ResultDesc
            })
            .eq(
                "checkout_request_id",
                callback.CheckoutRequestID
            );

        if (updateError) {
            console.error("Callback database error:", updateError);
        } else {
            console.log("💾 Payment updated to FAILED.");
        }

        console.log("=================================");
        console.log("❌ PAYMENT FAILED");
        console.log("=================================");
        console.log("Reason:", callback.ResultDesc);
    }

    // Always acknowledge receipt to Safaricom
    res.json({
        ResultCode: 0,
        ResultDesc: "Callback received successfully"
    });
});
app.get("/api/mpesa/payments", requireLogin, async (req, res) => {
    try {
        const { data: payments, error } = await supabase
            .from("payments")
            .select("*")
            .order("id", { ascending: false });

        if (error) {
            console.error("DATABASE ERROR:", error);

            return res.status(500).json({
                success: false,
                error: "Could not retrieve payments"
            });
        }

        res.json({
            success: true,
            count: payments.length,
            payments
        });

    } catch (error) {
        console.error("DATABASE ERROR:", error);

        res.status(500).json({
            success: false,
            error: "Could not retrieve payments"
        });
    }
});
app.get("/api/mpesa/status/:checkoutRequestId", requireLogin, async (req, res) => {
    try {
        const { data: payment, error } = await supabase
            .from("payments")
            .select("*")
            .eq("checkout_request_id", req.params.checkoutRequestId)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("STATUS DATABASE ERROR:", error);

            return res.status(500).json({
                success: false,
                error: "Could not check payment status"
            });
        }

        if (!payment) {
            return res.json({
                success: true,
                status: "PENDING"
            });
        }

        res.json({
            success: true,
            status: payment.status,
            payment
        });

    } catch (error) {
        console.error("STATUS ERROR:", error);

        res.status(500).json({
            success: false,
            error: "Could not check payment status"
        });
    }
});
app.get("/dashboard", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login.html");
    }

    res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/payments", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login.html");
    }

    res.sendFile(path.join(__dirname, "public", "payments.html"));
});
app.listen(PORT, () => {
    console.log(`Convenor M-Pesa API running on port ${PORT}`);
});