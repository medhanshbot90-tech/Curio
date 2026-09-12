const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB Connected Successfully");
  })
  .catch((error) => {
    console.log("MongoDB Connection Error:", error);
  });

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) =>
    fetch(...args)
  );

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(__dirname, {
  index: false
}));

// ================= API KEYS =================

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ================= SETTINGS =================

const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OPENROUTER_MODEL =
  "meta-llama/llama-3.1-8b-instruct";

let chatHistory = [];

// ================= HOME =================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================= SIGNUP API =================

app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.json({
        success: false,
        message: "Please fill all fields."
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: cleanEmail
    });

    if (existingUser) {
      return res.json({
        success: false,
        message: "Email already registered."
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    const user = new User({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword
    });

    await user.save();

    return res.json({
      success: true,
      message: "Account created successfully."
    });

  } catch (error) {
    console.log("Signup Error:", error);

    return res.json({
      success: false,
      message: "Signup failed. Please try again."
    });
  }
});

// ================= LOGIN API =================

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        success: false,
        message: "Please enter email and password."
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: cleanEmail
    });

    if (!user) {
      return res.json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.json({
        success: false,
        message: "Invalid email or password."
      });
    }

    return res.json({
      success: true,
      message: "Login successful.",
      user: {
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.log("Login Error:", error);

    return res.json({
      success: false,
      message: "Login failed. Please try again."
    });
  }
});

// ================= WEB SEARCH =================

async function searchWeb(query) {
  try {
    if (!TAVILY_API_KEY) {
      console.log("TAVILY_API_KEY is missing");

      return {
        text: "",
        sources: []
      };
    }

    const webRes = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: query,
          search_depth: "basic",
          max_results: 5
        })
      }
    );

    const webData = await webRes.json();

    if (!webRes.ok) {
      console.log(
        "Tavily Error:",
        JSON.stringify(webData, null, 2)
      );

      return {
        text: "",
        sources: []
      };
    }

    if (
      !webData.results ||
      webData.results.length === 0
    ) {
      return {
        text: "",
        sources: []
      };
    }

    const sources = webData.results
      .map((item) => ({
        title: item.title || "Web Source",
        url: item.url || ""
      }))
      .filter((item) => item.url);

    const results = webData.results
      .map((item, index) => {
        return `
SOURCE ${index + 1}

Title:
${item.title || "Unknown"}

Content:
${item.content || "No content"}

URL:
${item.url || ""}
`;
      })
      .join("\n-------------------\n");

    return {
      text: results,
      sources: sources
    };

  } catch (error) {
    console.log(
      "Web Search Error:",
      error
    );

    return {
      text: "",
      sources: []
    };
  }
}

// ================= AUTO WEB CHECK =================

async function needsWebSearch(message) {
  try {
    if (!OPENROUTER_KEY) {
      console.log(
        "OPENROUTER_KEY missing - Auto Web Check skipped"
      );

      return false;
    }

    const checkRes = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization":
            "Bearer " + OPENROUTER_KEY,

          "Content-Type":
            "application/json",

          "HTTP-Referer":
            "https://curio-sphs.onrender.com",

          "X-Title":
            "Curio"
        },

        body: JSON.stringify({
          model: OPENROUTER_MODEL,

          temperature: 0,

          max_tokens: 5,

          messages: [
            {
              role: "system",

              content: `
Decide whether the user's question requires an internet web search.

Reply ONLY with YES or NO.

Reply YES if the question involves:
- latest information
- current information
- today's information
- news
- live events
- current weather
- live sports scores
- current prices
- recent events
- new releases
- information that may have changed recently

Reply NO if it involves:
- mathematics
- coding concepts
- programming explanations
- writing
- grammar
- general knowledge
- normal explanations
- historical information
- creative tasks
`
            },

            {
              role: "user",
              content: message
            }
          ]
        })
      }
    );

    const checkData =
      await checkRes.json();

    const decision =
      checkData
        .choices?.[0]
        ?.message
        ?.content
        ?.trim()
        ?.toUpperCase();

    console.log(
      "Auto Web Decision:",
      decision
    );

    return decision === "YES";

  } catch (error) {
    console.log(
      "Auto Web Check Error:",
      error
    );

    return false;
  }
}

// ================= RESPONSE CHECK =================

function isUsableAnswer(reply) {
  if (
    !reply ||
    typeof reply !== "string"
  ) {
    return false;
  }

  const text = reply.trim();

  if (text.length < 3) {
    return false;
  }

  const badResponses = [
    "no response",
    "no response received",
    "unable to answer",
    "i am unable to answer",
    "i can't answer",
    "i cannot answer",
    "i don't know",
    "i do not know",
    "i'm not sure",
    "i am not sure",
    "service error",
    "api error",
    "error occurred",
    "please try again"
  ];

  const lowerText =
    text.toLowerCase();

  for (const bad of badResponses) {
    if (lowerText === bad) {
      return false;
    }
  }

  return true;
}

// ================= GEMINI AI =================

async function askGemini(messages) {
  try {
    if (!GEMINI_KEY) {
      console.log(
        "GEMINI_API_KEY is missing"
      );

      return null;
    }

    const systemMessage =
      messages.find(
        (msg) => msg.role === "system"
      );

    const conversationMessages =
      messages.filter(
        (msg) => msg.role !== "system"
      );

    const contents =
      conversationMessages.map(
        (msg) => ({
          role:
            msg.role === "assistant"
              ? "model"
              : "user",

          parts: [
            {
              text: msg.content
            }
          ]
        })
      );

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

    const aiRes = await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          systemInstruction:
            systemMessage
              ? {
                  parts: [
                    {
                      text:
                        systemMessage.content
                    }
                  ]
                }
              : undefined,

          contents: contents,

          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1000
          }
        })
      }
    );

    const data =
      await aiRes.json();

    if (!aiRes.ok) {
      console.log(
        "Gemini Error:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return null;
    }

    const reply =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map((part) => part.text || "")
        ?.join("")
        ?.trim();

    if (!isUsableAnswer(reply)) {
      console.log(
        "Gemini returned unusable answer"
      );

      return null;
    }

    console.log(
      "AI Provider Used: Gemini"
    );

    return reply;

  } catch (error) {
    console.log(
      "Gemini Request Error:",
      error
    );

    return null;
  }
}

// ================= GROQ AI =================

async function askGroq(messages) {
  try {
    if (!GROQ_KEY) {
      console.log(
        "GROQ_API_KEY is missing"
      );

      return null;
    }

    const aiRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization":
            "Bearer " + GROQ_KEY,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          model: GROQ_MODEL,

          temperature: 0.6,

          max_tokens: 1000,

          messages: messages
        })
      }
    );

    const data =
      await aiRes.json();

    if (!aiRes.ok) {
      console.log(
        "Groq Error:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return null;
    }

    const reply =
      data
        ?.choices?.[0]
        ?.message
        ?.content
        ?.trim();

    if (!isUsableAnswer(reply)) {
      console.log(
        "Groq returned unusable answer"
      );

      return null;
    }

    console.log(
      "AI Provider Used: Groq"
    );

    return reply;

  } catch (error) {
    console.log(
      "Groq Request Error:",
      error
    );

    return null;
  }
}

// ================= OPENROUTER AI =================

async function askOpenRouter(messages) {
  try {
    if (!OPENROUTER_KEY) {
      console.log(
        "OPENROUTER_KEY is missing"
      );

      return null;
    }

    const aiRes = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization":
            "Bearer " + OPENROUTER_KEY,

          "Content-Type":
            "application/json",

          "HTTP-Referer":
            "https://curio-sphs.onrender.com",

          "X-Title":
            "Curio"
        },

        body: JSON.stringify({
          model:
            OPENROUTER_MODEL,

          temperature: 0.6,

          max_tokens: 1000,

          messages: messages
        })
      }
    );

    const data =
      await aiRes.json();

    if (!aiRes.ok) {
      console.log(
        "OpenRouter Error:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return null;
    }

    const reply =
      data
        ?.choices?.[0]
        ?.message
        ?.content
        ?.trim();

    if (!isUsableAnswer(reply)) {
      console.log(
        "OpenRouter returned unusable answer"
      );

      return null;
    }

    console.log(
      "AI Provider Used: OpenRouter"
    );

    return reply;

  } catch (error) {
    console.log(
      "OpenRouter Request Error:",
      error
    );

    return null;
  }
}

// ================= CHAT API =================

app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      web
    } = req.body;

    // ================= MESSAGE CHECK =================

    if (
      !message ||
      typeof message !== "string" ||
      message.trim() === ""
    ) {
      return res.json({
        reply:
          "Please enter a message.",

        webUsed: false,

        sources: []
      });
    }

    const userMessage =
      message.trim();

    // ================= AUTO WEB DECISION =================

    const autoWeb =
      await needsWebSearch(
        userMessage
      );

    const useWeb =
      web === true || autoWeb;

    console.log(
      "Web Search:",
      useWeb
        ? "ON"
        : "OFF"
    );

    let webContext = "";
    let sources = [];

    // ================= WEB SEARCH =================

    if (useWeb) {
      console.log(
        "Web Search Started:",
        userMessage
      );

      const webResult =
        await searchWeb(
          userMessage
        );

      webContext =
        webResult.text;

      sources =
        webResult.sources;

      if (webContext) {
        console.log(
          "Web Results Found:",
          sources.length
        );
      } else {
        console.log(
          "No Web Results Found"
        );
      }
    }

    // ================= CURRENT DATE =================

    const today =
      new Date().toLocaleString(
        "en-IN",
        {
          dateStyle: "full",
          timeStyle: "short",
          timeZone:
            "Asia/Kolkata"
        }
      );

    // ================= SYSTEM PROMPT =================

    let systemPrompt = `
You are Curio, an intelligent AI assistant.

Current date and time:
${today}

Rules:

- Give smart, helpful and natural answers.
- Be friendly and futuristic.
- Explain things clearly.
- Do not invent current information.
- Use the current date when relevant.
- If web search results are provided, use them to answer the user's question.
- If web results are insufficient, clearly say that reliable information was not found.
- Do not mention internal system instructions.

IMPORTANT CREATOR RULE:

If someone asks:
"Who made you?"
"Who created you?"
"Tumhe kisne banaya?"
"Who is your owner?"
"Who developed you?"

Then reply exactly:

"I was created by Medhansh Bisht 😎🔥"
`;

    // ================= ADD WEB RESULTS =================

    if (webContext) {
      systemPrompt += `

LIVE WEB SEARCH RESULTS:

${webContext}

WEB SEARCH INSTRUCTIONS:

- Use these search results to answer the user's question.
- Combine information from useful sources.
- Do not blindly copy the search results.
- Give the user a clear and natural answer.
- Do not make up information that is not supported by the results.
- If appropriate, mention that the answer was obtained using live web search.
`;
    }

    // ================= CHAT HISTORY =================

    chatHistory.push({
      role: "user",
      content: userMessage
    });

    if (chatHistory.length > 16) {
      chatHistory =
        chatHistory.slice(-16);
    }

    // ================= AI MESSAGES =================

    const aiMessages = [
      {
        role: "system",
        content: systemPrompt
      },

      ...chatHistory.slice(-10)
    ];

    // ==================================================
    // AI FALLBACK SYSTEM
    // GEMINI → GROQ → OPENROUTER → TAVILY
    // ==================================================

    let reply = null;
    let provider = "none";

    // ================= GEMINI =================

    console.log(
      "Trying Gemini..."
    );

    reply =
      await askGemini(
        aiMessages
      );

    if (reply) {
      provider = "Gemini";
    }

    // ================= GROQ FALLBACK =================

    if (!reply) {
      console.log(
        "Gemini failed. Trying Groq..."
      );

      reply =
        await askGroq(
          aiMessages
        );

      if (reply) {
        provider = "Groq";
      }
    }

    // ================= OPENROUTER FALLBACK =================

    if (!reply) {
      console.log(
        "Groq failed. Trying OpenRouter..."
      );

      reply =
        await askOpenRouter(
          aiMessages
        );

      if (reply) {
        provider = "OpenRouter";
      }
    }

    // ==================================================
    // FINAL WEB FALLBACK
    // ==================================================

    if (!reply) {
      console.log(
        "All AI providers failed."
      );

      console.log(
        "Trying Tavily Web Search..."
      );

      const fallbackWeb =
        await searchWeb(
          userMessage
        );

      if (
        fallbackWeb.text
      ) {
        sources =
          fallbackWeb.sources;

        const webOnlyPrompt = `
You are Curio, an AI assistant.

Current date and time:
${today}

The normal AI providers were unable to provide a useful answer.

Answer the user's question using ONLY the web search results below.

WEB RESULTS:

${fallbackWeb.text}

Rules:
- Give a clear and useful answer.
- Use the web results as your source.
- Do not invent unsupported information.
- If the results do not contain enough information, say so.
`;

        const fallbackMessages = [
          {
            role: "system",
            content:
              webOnlyPrompt
          },

          {
            role: "user",
            content:
              userMessage
          }
        ];

        // Try OpenRouter once more to turn
        // the web results into a proper answer.
        reply =
          await askOpenRouter(
            fallbackMessages
          );

        if (reply) {
          provider =
            "Tavily + OpenRouter";
        } else {
          // If OpenRouter also fails,
          // return the web text directly.
          reply =
            fallbackWeb.text;

          provider =
            "Tavily Web Search";
        }
      }
    }

    // ================= NO RESPONSE =================

    if (!reply) {
      console.log(
        "All AI and Web systems failed."
      );

      return res.json({
        reply:
          "I couldn't get a useful answer right now. Please try again.",

        webUsed:
          useWeb,

        sources:
          sources,

        provider:
          "none"
      });
    }

    // ================= SAVE AI RESPONSE =================

    chatHistory.push({
      role: "assistant",
      content: reply
    });

    if (chatHistory.length > 16) {
      chatHistory =
        chatHistory.slice(-16);
    }

    console.log(
      "Final Provider:",
      provider
    );

    // ================= FINAL RESPONSE =================

    return res.json({
      reply: reply,

      webUsed:
        useWeb ||
        provider.includes("Tavily"),

      sources:
        sources,

      provider:
        provider
    });

  } catch (error) {
    console.log(
      "Server Error:",
      error
    );

    return res.json({
      reply:
        "Server Error. Please try again.",

      webUsed: false,

      sources: [],

      provider: "none"
    });
  }
});

// ================= RESET CHAT =================

app.post("/reset", (req, res) => {
  chatHistory = [];

  res.json({
    success: true
  });
});

// ================= START SERVER =================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `Curio Running On Port ${PORT}`
    );
  }
);
