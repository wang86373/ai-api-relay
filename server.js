require("dotenv").config();

console.log("CURRENT SERVER.JS LOADED");

const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const OpenAI = require("openai");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  return res.json({ received: true });
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
function generateApiKey() {
  return "sk-" + Math.random().toString(36).substring(2) + Date.now();
}

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
app.post("/create-api-key", async (req, res) => {
  try {

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required"
      });
    }

    const apiKey = generateApiKey();

    const { error } = await supabase
      .from("api_keys")
      .insert([
        {
          user_email: email,
          api_key: apiKey,
          is_active: true
        }
      ]);

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      apiKey
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message || "Failed to create api key"
    });
  }
});

app.post("/get-api-keys", async (req, res) => {
  try {

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required"
      });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .select("api_key, key_name, is_active, created_at")
      .eq("user_email", email)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      keys: data
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Failed to get api keys"
    });
  }
});

app.post("/delete-api-key", async (req, res) => {

  try {

    const { api_key } = req.body;

    if (!api_key) {

      return res.status(400).json({
        error: "API key required"
      });

    }

    const { error } = await supabase
      .from("api_keys")
      .delete()
      .eq("api_key", api_key);

    if (error) {

      return res.status(500).json({
        error: error.message
      });

    }

    return res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Delete failed"
    });

  }

});

app.post("/rename-api-key", async (req, res) => {
  try {

    const { api_key, key_name } = req.body;

    if (!api_key || !key_name) {
      return res.status(400).json({
        error: "api_key and key_name required"
      });
    }

    const { error } = await supabase
      .from("api_keys")
      .update({
        key_name
      })
      .eq("api_key", api_key);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    return res.json({
      success: true
    });

  } catch (err) {

    return res.status(500).json({
      error: "Rename failed"
    });

  }
});

app.post("/usage-logs", async (req, res) => {

  try {

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required"
      });
    }

    const { data, error } = await supabase
      .from("usage_logs")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    return res.json({
      success: true,
      logs: data
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Failed to load logs"
    });

  }

});

app.post("/usage-stats", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required"
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("usage_logs")
      .select("total_tokens, cost, created_at")
      .eq("email", email)
      .gte("created_at", today.toISOString());

    if (error) throw error;

    const totalRequests = data.length;

    const totalTokens = data.reduce(
      (sum, row) => sum + Number(row.total_tokens || 0),
      0
    );

    const totalCost = data.reduce(
      (sum, row) => sum + Number(row.cost || 0),
      0
    );

    return res.json({
      success: true,
      totalRequests,
      totalTokens,
      totalCost
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message || "Failed to load usage stats"
    });

  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com"
  })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new OpenAI({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com/v1/"
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

app.post("/admin/verify", (req, res) => {
  if (!checkAdmin(req, res)) return;

  return res.json({
    success: true
  });
});

function createApiKey() {
  return (
    "sk_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

app.get("/", (req, res) => {
  res.redirect("/register.html");
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

    const { data: usageLogs } = await supabase
      .from("usage_logs")
      .select("*");

    const keysWithStats = data.map(key => {
      const logs = (usageLogs || []).filter(
        log => log.api_key === key.api_key
      );

      const totalRequests = logs.length;

      const totalTokens = logs.reduce((sum, log) => {
        return sum + Number(log.total_tokens || 0);
      }, 0);

      const totalCost = logs.reduce((sum, log) => {
        return sum + Number(log.cost || 0);
      }, 0);

      const lastUsedAt = logs.length > 0
        ? logs
          .map(log => log.created_at)
          .filter(Boolean)
          .sort()
          .reverse()[0]
        : null;

      return {
        ...key,
        total_requests: totalRequests,
        total_tokens: totalTokens,
        total_cost: totalCost,
        last_used_at: lastUsedAt
      };
    });

    return res.json({
      success: true,
      keys: keysWithStats
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.get("/admin/today-stats", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("usage_logs")
      .select("api_key, email, total_tokens, cost, created_at")
      .gte("created_at", today.toISOString());

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    const todayRequests = data.length;

    const todayTokens = data.reduce((sum, log) => {
      return sum + Number(log.total_tokens || 0);
    }, 0);

    const todayRevenue = data.reduce((sum, log) => {
      return sum + Number(log.cost || 0);
    }, 0);

    const onlineUsers = new Set(
      data
        .map(log => log.email || log.api_key)
        .filter(Boolean)
    ).size;

    return res.json({
      success: true,
      todayRequests,
      todayTokens,
      todayRevenue,
      onlineUsers
    });

  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.get("/admin/stats", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {

    const { data, error } = await supabase
      .from("usage_logs")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    const grouped = {};

    data.forEach(log => {

      const hour =
        new Date(log.created_at)
          .toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          });

      grouped[hour] =
        (grouped[hour] || 0) + 1;
    });

    const labels = Object.keys(grouped);
    const requests = Object.values(grouped);

    res.json({
      success: true,
      labels,
      requests
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });
  }

});

app.get("/admin/usdt-stats", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  try {

    const { data, error } = await supabase
      .from("usdt_payments")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    const grouped = {};

    data.forEach(payment => {

      const day =
        new Date(payment.created_at)
        .toLocaleDateString();

      grouped[day] =
        (grouped[day] || 0)
        + Number(payment.amount || 0);
    });

    const labels = Object.keys(grouped);

    const amounts =
      Object.values(grouped);

    res.json({
      success: true,
      labels,
      amounts
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/toggle-key", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { key_id, is_active } = req.body;

    const { error } = await supabase
      .from("api_keys")
      .update({
        is_active
      })
      .eq("id", key_id);

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    res.json({
      success: true
    });

  } catch (err) {
    res.status(500).json({
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

    const { error } = await supabase
      .from("api_keys")
      .delete()
      .eq("api_key", api_key);

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    return res.json({
      success: true
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

app.get("/usdt/history/:apiKey", async (req, res) => {
  try {

    const apiKey = req.params.apiKey;

    const { data, error } = await supabase
      .from("usdt_payments")
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
      payments: data
    });

  } catch (err) {

    return res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

app.get("/v1/models", async (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "gpt-4o-mini",
        object: "model",
        owned_by: "ai-api-relay"
      },
      {
        id: "deepseek-chat",
        object: "model",
        owned_by: "ai-api-relay"
      }
    ]
  });
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

    if (keyError || !keyData) {
      return res.status(401).json({
        error: {
          message: "Invalid API key"
        }
      });
    }

    if (Number(keyData.balance || 0) <= 0) {
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
      }),

      ...(anthropic && {
        "claude-3-5-sonnet": {
          client: anthropic,
          upstreamModel: "claude-3-5-sonnet-20241022",
          pricePerToken: 0.00002
        }
      })
    };

    const selectedModel = modelConfig[model];

    if (!selectedModel) {
      return res.status(400).json({
        error: {
          message: "Model not supported"
        }
      });
    }

    const completion = await selectedModel.client.chat.completions.create({
      model: selectedModel.upstreamModel,
      messages
    });

    let pricePer1k = 0.01;

    if (model === "deepseek-chat") {
      pricePer1k = 0.002;
    }

    if (model === "claude-3-5-sonnet") {
      pricePer1k = 0.03;
    }

    const cost =
      ((completion.usage?.total_tokens || 0) / 1000) * pricePer1k;

    const { error: logError } = await supabase.from("usage_logs").insert({
      api_key: apiKey,
      email: keyData.user_email,
      model,

      prompt_tokens: completion.usage?.prompt_tokens || 0,
      completion_tokens: completion.usage?.completion_tokens || 0,
      total_tokens: completion.usage?.total_tokens || 0,
      cost
    });

    if (logError) {
      console.error("Usage log insert error:", logError.message);
    }

    await supabase
      .from("api_keys")
      .update({
        balance: Math.max(
          0,
          Number(keyData.balance || 0) - cost
        )
      })
      .eq("api_key", apiKey);

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

async function verifyUsdtTrc20Payment(txHash, expectedAmount) {
  const receiveAddress = process.env.USDT_TRC20_RECEIVE_ADDRESS;

  if (!receiveAddress) {
    throw new Error("USDT_TRC20_RECEIVE_ADDRESS is not configured");
  }

  const url =
    "https://apilist.tronscanapi.com/api/transaction-info?hash=" +
    encodeURIComponent(txHash);

  const response = await fetch(url);
  const tx = await response.json();

  if (!response.ok || !tx) {
    throw new Error("Failed to verify transaction");
  }

  if (tx.confirmed !== true) {
    throw new Error("Transaction is not confirmed yet");
  }

  if (tx.revert === true) {
    throw new Error("Transaction was reverted");
  }

  if (tx.contractRet && tx.contractRet !== "SUCCESS") {
    throw new Error("Transaction failed on-chain");
  }

  const transfers = tx.trc20TransferInfo || [];

  const usdtTransfer = transfers.find(t => {
    return (
      t.contract_address === USDT_TRC20_CONTRACT &&
      t.to_address === receiveAddress
    );
  });

  if (!usdtTransfer) {
    throw new Error("No matching USDT TRC20 transfer found");
  }

  const actualAmount =
    Number(usdtTransfer.amount_str || usdtTransfer.amount || 0) / 1000000;

  if (actualAmount < Number(expectedAmount)) {
    throw new Error("USDT amount is less than submitted amount");
  }

  return {
    success: true,
    amount: actualAmount,
    from: usdtTransfer.from_address,
    to: usdtTransfer.to_address
  };
}

app.post("/usdt/submit", async (req, res) => {
  try {

    const {
      api_key,
      amount,
      tx_hash
    } = req.body;

    if (!api_key || !amount || !tx_hash) {
      return res.status(400).json({
        error: {
          message: "Missing fields"
        }
      });
    }

    const { data: existingPayment } = await supabase
      .from("usdt_payments")
      .select("id")
      .eq("tx_hash", tx_hash)
      .maybeSingle();

    if (existingPayment) {
      return res.status(400).json({
        error: {
          message: "This transaction has already been used"
        }
      });
    }

    const verifyResult =
      await verifyUsdtTrc20Payment(tx_hash, amount);

    const { error } = await supabase
      .from("usdt_payments")
      .insert([
        {
          api_key,
          amount,
          tx_hash,
          status: "confirmed"
        }
      ]);

    const { data: existingKey } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", api_key)
      .single();

    if (!existingKey) {
      return res.status(404).json({
        error: {
          message: "API key not found"
        }
      });
    }

    const { error: updateError } = await supabase
      .from("api_keys")
      .update({
        balance:
          Number(existingKey.balance || 0) +
          Number(verifyResult.amount)
      })
      .eq("api_key", api_key);

    if (updateError) {
      return res.status(500).json({
        error: {
          message: updateError.message
        }
      });
    }

    res.json({
      success: true,
      status: "confirmed",
      amount: verifyResult.amount,
      message: "USDT payment verified and balance updated"
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

app.get("/usdt/history/:apiKey", async (req, res) => {
  try {

    const apiKey = req.params.apiKey;

    const { data, error } = await supabase
      .from("usdt_payments")
      .select("*")
      .eq("api_key", apiKey)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    res.json({
      success: true,
      payments: data
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

app.get("/admin/usdt-payments", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { data, error } = await supabase
      .from("usdt_payments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    res.json({
      success: true,
      payments: data
    });

  } catch (err) {
    res.status(500).json({
      error: {
        message: err.message
      }
    });
  }
});

app.post("/admin/confirm-usdt", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  try {

    const { payment_id } = req.body;

    const { data: payment, error: paymentError } = await supabase
      .from("usdt_payments")
      .select("*")
      .eq("id", payment_id)
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({
        error: {
          message: "Payment not found"
        }
      });
    }

    if (payment.status === "confirmed") {
      return res.status(400).json({
        error: {
          message: "Already confirmed"
        }
      });
    }

    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", payment.api_key)
      .single();

    if (keyError || !keyData) {
      return res.status(404).json({
        error: {
          message: "API key not found"
        }
      });
    }

    const newBalance =
      Number(keyData.balance || 0) + Number(payment.amount);

    await supabase
      .from("api_keys")
      .update({
        balance: newBalance
      })
      .eq("id", keyData.id);

    await supabase
      .from("usdt_payments")
      .update({
        status: "confirmed"
      })
      .eq("id", payment.id);

    res.json({
      success: true,
      balance: newBalance
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

app.get("/admin/usdt-payments", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  try {

    const { data, error } = await supabase
      .from("usdt_payments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: {
          message: error.message
        }
      });
    }

    res.json({
      payments: data
    });

  } catch (err) {

    res.status(500).json({
      error: {
        message: err.message
      }
    });

  }
});

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