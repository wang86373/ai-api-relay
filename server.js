require("dotenv").config();

console.log("CURRENT SERVER.JS LOADED");
console.log("OPENAI KEY:", process.env.OPENAI_API_KEY);

const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const OpenAI = require("openai");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userEmail = session.customer_email;
      const amount = session.amount_total / 100;

      console.log("Stripe paid:", userEmail, amount);

      if (userEmail && amount > 0) {
        const { data: user, error: userError } = await supabase
          .from("users")
          .select("balance")
          .eq("email", userEmail)
          .single();

        if (userError || !user) {
          console.error("User not found:", userEmail);
        } else {
          const newBalance = Number(user.balance || 0) + amount;

          const { error: updateError } = await supabase
            .from("users")
            .update({ balance: newBalance })
            .eq("email", userEmail);

          if (updateError) {
            console.error("Balance update failed:", updateError);
          } else {
            console.log("Balance updated:", userEmail, newBalance);
          }
        }
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase ENV");
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com"
    })
  : null;

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: {
      message: "Too many requests"
    }
  }
});

function checkAdmin(req, res) {
  const adminKey = req.headers["x-admin-key"];

  if (!process.env.ADMIN_SECRET) {
    res.status(500).json({
      error: {
        message: "ADMIN_SECRET is not configured"
      }
    });
    return false;
  }

  if (adminKey !== process.env.ADMIN_SECRET) {
    res.status(404).json({
      error: {
        message: "Not found"
      }
    });
    return false;
  }

  return true;
}

function createApiKey() {
  return (
    "sk_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "AI API Relay"
  });
});

app.post("/register", async (req, res) => {
  try {
    const email = req.body.email;

    if (!email) {
      return res.status(400).json({
        error: {
          message: "Email required"
        }
      });
    }

    const newApiKey = createApiKey();

    const { data, error } = await supabase
      .from("api_keys")
      .insert([
        {
          api_key: newApiKey,
          owner_name: email,
          user_email: email,
          balance: 5,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      balance: data.balance
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/create-key", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const ownerName = req.body.owner_name || "user";
    const newApiKey = createApiKey();

    const { data, error } = await supabase
      .from("api_keys")
      .insert([
        {
          api_key: newApiKey,
          owner_name: ownerName,
          user_email: req.body.user_email || null,
          balance: Number(req.body.balance || 0),
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      balance: data.balance
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.get("/admin/keys", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      keys: data
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/recharge", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { api_key, amount } = req.body;

    if (!api_key || !amount || Number(amount) <= 0) {
      return res.status(400).json({
        error: {
          message: "api_key and positive amount are required"
        }
      });
    }

    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", api_key)
      .single();

    if (keyError || !keyData) {
      return res.status(404).json({
        error: {
          message: "API key not found"
        }
      });
    }

const { data: userData, error: userError } = await supabase
  .from("users")
  .select("*")
  .eq("email", keyData.user_email)
  .single();

if (userError || !userData) {
  return res.status(404).json({
    error: {
      message: "User not found"
    }
  });
}

if (Number(userData.balance || 0) <= 0) {
  return res.status(402).json({
    error: {
      message: "Insufficient balance"
    }
  });
}

    const newBalance = Number(keyData.balance) + Number(amount);

    const { data, error } = await supabase
      .from("api_keys")
      .update({
        balance: newBalance
      })
      .eq("id", keyData.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      balance: data.balance
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/disable-key", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({
        error: {
          message: "api_key is required"
        }
      });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .update({
        is_active: false
      })
      .eq("api_key", api_key)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      is_active: data.is_active
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/enable-key", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({
        error: {
          message: "api_key is required"
        }
      });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .update({
        is_active: true
      })
      .eq("api_key", api_key)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      is_active: data.is_active
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/delete-key", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({
        error: {
          message: "api_key is required"
        }
      });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .delete()
      .eq("api_key", api_key)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      deleted_api_key: data.api_key
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.get("/key/:apiKey", async (req, res) => {
  try {
    const apiKey = req.params.apiKey;

    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", apiKey)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: {
          message: "API key not found"
        }
      });
    }

    return res.json({
      success: true,
      api_key: data.api_key,
      owner_name: data.owner_name,
      user_email: data.user_email,
      balance: data.balance,
      is_active: data.is_active,
      created_at: data.created_at
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.get("/logs/:apiKey", async (req, res) => {
  try {
    const apiKey = req.params.apiKey;

    const { data, error } = await supabase
      .from("usage_logs")
      .select("*")
      .eq("api_key", apiKey)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      logs: data
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/v1/chat/completions", apiLimiter, async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const apiKey = auth.replace("Bearer ", "").trim();

    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .single();

      const { data: userData, error: userError } = await supabase
  .from("users")
  .select("*")
  .eq("email", keyData.user_email)
  .single();

if (userError || !userData) {
  return res.status(404).json({
    error: {
      message: "User not found"
    }
  });
}

    if (keyError || !keyData) {
      return res.status(401).json({
        error: {
          message: "Invalid API key"
        }
      });
    }

    if (Number(keyData.balance) <= 0) {
      return res.status(402).json({
        error: {
          message: "Insufficient balance"
        }
      });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: "messages is required"
        }
      });
    }

    const model = req.body.model || "gpt-4o-mini";

    const modelConfig = {
      "gpt-4o-mini": {
        client: openai,
        upstreamModel: "gpt-4o-mini",
        pricePerToken: 0.00001
      },

      ...(deepseek && {
        "deepseek-chat": {
          client: deepseek,
          upstreamModel: "deepseek-chat",
          pricePerToken: 0.000005
        }
      })
    };

    const selectedModel = modelConfig[model];

    if (!selectedModel) {
      return res.status(400).json({
        error: {
          message: "Unsupported model"
        }
      });
    }

    const completion = await selectedModel.client.chat.completions.create({
      model: selectedModel.upstreamModel,
      messages
    });

    await supabase.from("usage_logs").insert({
      api_key: apiKey,
      model,
      prompt_tokens: completion.usage?.prompt_tokens || 0,
      completion_tokens: completion.usage?.completion_tokens || 0,
      total_tokens: completion.usage?.total_tokens || 0
    });

    const cost =
      (completion.usage?.total_tokens || 0) * selectedModel.pricePerToken;

    await supabase
  .from("users")
  .update({
    balance: Math.max(0, Number(userData.balance || 0) - cost)
  })
  .eq("email", keyData.user_email);

    return res.json(completion);
  } catch (err) {
    console.error("Relay error:", err);

    return res.status(500).json({
      error: {
        message: err.message || "Internal server error"
      }
    });
  }
});

app.use(express.static("public"));

app.post("/create-checkout-session", async (req, res) => {
  try {

    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({
        error: {
          message: "api_key required"
        }
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "AI API Relay Balance"
            },
            unit_amount: 1000
          },
          quantity: 1
        }
      ],

      mode: "payment",

        success_url:
  "https://ai-api-relay-production-1ab2.up.railway.app/stripe/success?session_id={CHECKOUT_SESSION_ID}",

cancel_url:
  "https://ai-api-relay-production-1ab2.up.railway.app/dashboard.html?canceled=1",
  
      metadata: {
        api_key
      }

    });

    res.json({
      url: session.url
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

app.get("/stripe/success", async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).send("Missing session_id");
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const apiKey = session.metadata.api_key;

    if (!apiKey) {
      return res.status(400).send("Missing api_key");
    }

    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", apiKey)
      .single();

    if (keyError || !keyData) {
      return res.status(404).send("API key not found");
    }

    const newBalance = Number(keyData.balance) + 10;

    const { error } = await supabase
      .from("api_keys")
      .update({
        balance: newBalance
      })
      .eq("id", keyData.id);

    if (error) {
      return res.status(500).send(error.message);
    }

    return res.redirect("/dashboard.html?paid=1");

  } catch (err) {
    return res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("AI API Relay running on port " + PORT);
});