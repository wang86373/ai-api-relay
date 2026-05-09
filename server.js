require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: {
      message: "Too many requests"
    }
  }
});
if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error("Missing Supabase ENV");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


const deepseek =
  process.env.DEEPSEEK_API_KEY
    ? new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com"
      })
    : null;

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "AI API Relay"
  });
});

app.post("/admin/create-key", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
          message: "Unauthorized"
        }
      });
    }

    const ownerName = req.body.owner_name || "user";

    const newApiKey =
      "sk_" + Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);

    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        api_key: newApiKey,
        owner_name: ownerName,
        balance: 0,
        is_active: true
      })
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

app.post("/admin/recharge", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
                    message: "Unauthorized"
        }
      });
    }

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

    const newBalance =
      Number(keyData.balance) + Number(amount);

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

app.get("/admin/keys", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
          message: "Unauthorized"
        }
      });
    }

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

app.post("/admin/disable-key", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
          message: "Unauthorized"
        }
      });
    }

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
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
          message: "Unauthorized"
        }
      });
    }

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
  try {
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(401).json({
        error: {
          message: "Unauthorized"
        }
      });
    }

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

    const { data: keyData, error: keyError } =
  await supabase
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

const selectedModel =
  modelConfig[model];

if (!selectedModel) {
  return res.status(400).json({
    error: {
      message: "Unsupported model"
    }
  });
}

    const completion =
await selectedModel.client.chat.completions.create({
  model: selectedModel.upstreamModel,
  messages
});

await supabase
  .from("usage_logs")
  .insert({
    api_key: apiKey,
    model,
    prompt_tokens: completion.usage?.prompt_tokens || 0,
    completion_tokens: completion.usage?.completion_tokens || 0,
    total_tokens: completion.usage?.total_tokens || 0
  });

  const cost =
  (completion.usage?.total_tokens || 0) *
  selectedModel.pricePerToken;

await supabase
  .from("api_keys")
  .update({
    balance: Math.max(
      0,
      Number(keyData.balance) - cost
    )
  })
  .eq("id", keyData.id);

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("AI API Relay running on port " + PORT);
});