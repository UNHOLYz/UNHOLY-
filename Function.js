const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const axios = require("axios");
const config = require("./config");

// ======================================
// CREATE SESSION FOLDER
// ======================================

if (!fs.existsSync("./session")) {
  fs.mkdirSync("./session");
}

// ======================================
// STORE
// ======================================

const store = makeInMemoryStore({
  logger: pino({ level: "silent" })
});

// ======================================
// CHECK ADMIN
// ======================================

function isAdmin(sender) {
  return config.ADMINS.includes(sender);
}

// ======================================
// GEMINI AI
// ======================================

async function askGemini(prompt) {

  try {

    if (!process.env.GEMINI_API_KEY) {
      return "My AI brain is sleeping 😴";
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      }
    );

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "I forgot what I was saying 😭";

  } catch (err) {

    console.log("Gemini Error:", err.message);

    return "AI issue right now.";

  }
}

// ======================================
// ALICE AI SYSTEM
// ======================================

async function handleAlice(
  sock,
  text,
  from,
  sender,
  isGroup
) {

  const lower = text.toLowerCase();

  // Wake word
  if (!lower.startsWith("alice")) return;

  // Remove wake word
  const userCommand =
    text.replace(/alice/i, "").trim();

  const admin = isAdmin(sender);

  let aiResult = null;

  // ======================================
  // AI INTENT PARSER
  // ======================================

  try {

    if (process.env.GEMINI_API_KEY) {

      const prompt = `
You are an AI intent parser for a WhatsApp assistant named Alice.

Return ONLY valid JSON.

Actions:
- kick
- promote
- demote
- mute
- unmute
- call
- message
- play_music
- tagall
- groupinfo
- chat

Examples:

User: kick 2348011111111
Response:
{"action":"kick","target":"2348011111111"}

User: promote 2348011111111
Response:
{"action":"promote","target":"2348011111111"}

User: mute this group
Response:
{"action":"mute"}

User: call mom
Response:
{"action":"call","target":"mom"}

User: play music
Response:
{"action":"play_music"}

User: send message to 2348011111111 hello bro
Response:
{"action":"message","target":"2348011111111","message":"hello bro"}

User:
"${userCommand}"
`;

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        }
      );

      const raw =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

      aiResult = JSON.parse(raw);

    }

  } catch (err) {

    console.log("Intent Error:", err.message);

  }

  // ======================================
  // FALLBACK
  // ======================================

  if (!aiResult) {

    aiResult = {
      action: "chat",
      text: userCommand
    };

  }

  // ======================================
  // ACTION SYSTEM
  // ======================================

  switch (aiResult.action) {

    // ==================================
    // KICK USER
    // ==================================

    case "kick": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "😌 Admin only."
        });

      }

      if (!isGroup) {

        return sock.sendMessage(from, {
          text: "That only works in groups."
        });

      }

      let number = aiResult.target;

      if (!number) {

        return sock.sendMessage(from, {
          text: "Which number am I removing?"
        });

      }

      number = number.replace(/\D/g, "");

      const jid =
        number + "@s.whatsapp.net";

      try {

        await sock.groupParticipantsUpdate(
          from,
          [jid],
          "remove"
        );

        return sock.sendMessage(from, {
          text: `🚪 Removed ${number}`
        });

      } catch {

        return sock.sendMessage(from, {
          text: "Couldn't remove that user."
        });

      }
    }

    // ==================================
    // PROMOTE USER
    // ==================================

    case "promote": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "Admins only 😎"
        });

      }

      if (!isGroup) return;

      let number =
        aiResult.target.replace(/\D/g, "");

      const jid =
        number + "@s.whatsapp.net";

      await sock.groupParticipantsUpdate(
        from,
        [jid],
        "promote"
      );

      return sock.sendMessage(from, {
        text: `⚡ ${number} is now admin`
      });
    }

    // ==================================
    // DEMOTE USER
    // ==================================

    case "demote": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "Admins only 😌"
        });

      }

      if (!isGroup) return;

      let number =
        aiResult.target.replace(/\D/g, "");

      const jid =
        number + "@s.whatsapp.net";

      await sock.groupParticipantsUpdate(
        from,
        [jid],
        "demote"
      );

      return sock.sendMessage(from, {
        text: `⬇️ ${number} demoted`
      });
    }

    // ==================================
    // MUTE GROUP
    // ==================================

    case "mute": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "Admins only 😭"
        });

      }

      if (!isGroup) return;

      await sock.groupSettingUpdate(
        from,
        "announcement"
      );

      return sock.sendMessage(from, {
        text: "🔇 Group muted."
      });
    }

    // ==================================
    // UNMUTE GROUP
    // ==================================

    case "unmute": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "Admins only."
        });

      }

      if (!isGroup) return;

      await sock.groupSettingUpdate(
        from,
        "not_announcement"
      );

      return sock.sendMessage(from, {
        text: "🔊 Group unmuted."
      });
    }

    // ==================================
    // TAG ALL
    // ==================================

    case "tagall": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "Admins only."
        });

      }

      if (!isGroup) return;

      const metadata =
        await sock.groupMetadata(from);

      const mentions =
        metadata.participants.map(
          p => p.id
        );

      let text =
        "📢 Attention everyone:\n\n";

      mentions.forEach((m, i) => {

        text +=
          `${i + 1}. @${m.split("@")[0]}\n`;

      });

      return sock.sendMessage(from, {
        text,
        mentions
      });
    }

    // ==================================
    // GROUP INFO
    // ==================================

    case "groupinfo": {

      if (!isGroup) return;

      const metadata =
        await sock.groupMetadata(from);

      return sock.sendMessage(from, {
        text:
`📌 Group: ${metadata.subject}

👥 Members: ${metadata.participants.length}

📝 Description:
${metadata.desc || "No description"}`
      });
    }

    // ==================================
    // CALL COMMAND
    // ==================================

    case "call": {

      return sock.sendMessage(from, {
        text:
`📞 Calling ${aiResult.target} now...`
      });
    }

    // ==================================
    // SEND MESSAGE
    // ==================================

    case "message": {

      if (!admin) {

        return sock.sendMessage(from, {
          text: "😌 Only admins can make me text people."
        });

      }

      let target = aiResult.target;
      let message = aiResult.message;

      if (!target || !message) {

        return sock.sendMessage(from, {
          text: "Tell me who and what to send 😭"
        });

      }

      let number =
        target.replace(/\D/g, "");

      if (number.length < 10) {

        return sock.sendMessage(from, {
          text: "That number looks wrong 😭"
        });

      }

      const jid =
        number + "@s.whatsapp.net";

      try {

        await sock.sendMessage(jid, {
          text: message
        });

        return sock.sendMessage(from, {
          text:
`✉️ Message sent to ${number}`
        });

      } catch (err) {

        console.log(err);

        return sock.sendMessage(from, {
          text: "Couldn't send that message."
        });

      }
    }

    // ==================================
    // PLAY MUSIC
    // ==================================

    case "play_music": {

      return sock.sendMessage(from, {
        text:
"🎵 DJ Alice activated."
      });
    }

    // ==================================
    // NORMAL AI CHAT
    // ==================================

    default: {

      const reply =
        await askGemini(
`
You are Alice.

You are:
- witty
- smart
- funny
- confident
- human-like

Reply naturally like a smart friend.
Keep replies short.

User:
${userCommand}
`
        );

      return sock.sendMessage(from, {
        text: reply
      });
    }
  }
}

// ======================================
// START BOT
// ======================================

async function startBot() {

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    "./session"
  );

  const {
    version
  } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({

    logger: pino({
      level: "silent"
    }),

    auth: state,

    version,

    browser: [
      "Alice Bot",
      "Chrome",
      "1.0.0"
    ],

    printQRInTerminal: false

  });

  store.bind(sock.ev);

  // ======================================
  // PAIRING CODE LOGIN
  // ======================================

  if (!sock.authState.creds.registered) {

    const phoneNumber =
      process.env.OWNER_NUMBER
      || config.OWNER_NUMBER;

    setTimeout(async () => {

      try {

        const code =
          await sock.requestPairingCode(
            phoneNumber
          );

        console.log("\n=====================");
        console.log("PAIRING CODE:");
        console.log(code);
        console.log("=====================\n");

      } catch (err) {

        console.log(
          "Pairing failed. Retrying..."
        );

        startBot();

      }

    }, 3000);
  }

  // ======================================
  // AUTO REJECT CALLS
  // ======================================

  sock.ev.on("call", async (calls) => {

    for (const call of calls) {

      if (call.status === "offer") {

        const callerId = call.from;

        console.log(
          `Incoming call from ${callerId}`
        );

        try {

          // Reject Call
          await sock.rejectCall(
            call.id,
            callerId
          );

          // Auto Reply
          await sock.sendMessage(
            callerId,
            {
              text:
"Please leave a message, I am currently busy, I'll get back to you shortly."
            }
          );

          console.log(
            `Rejected call from ${callerId}`
          );

        } catch (err) {

          console.log(
            "Call Reject Error:",
            err.message
          );

        }
      }
    }
  });

  // ======================================
  // CONNECTION
  // ======================================

  sock.ev.on(
    "connection.update",
    async (update) => {

      const {
        connection,
        lastDisconnect
      } = update;

      if (connection === "close") {

        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode
          !== DisconnectReason.loggedOut;

        console.log("Disconnected.");

        if (shouldReconnect) {

          console.log("Reconnecting...");

          startBot();

        }
      }

      if (connection === "open") {

        console.log(
          "✅ Alice Bot Connected"
        );

      }
    }
  );

  // ======================================
  // SAVE CREDS
  // ======================================

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  // ======================================
  // MESSAGE LISTENER
  // ======================================

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {

      try {

        const msg = messages[0];

        if (!msg.message) return;

        const from =
          msg.key.remoteJid;

        const isGroup =
          from.endsWith("@g.us");

        const sender =
          isGroup
            ? msg.key.participant
            : msg.key.remoteJid;

        const body =
          msg.message.conversation
          || msg.message.extendedTextMessage?.text
          || msg.message.imageMessage?.caption
          || msg.message.videoMessage?.caption
          || "";

        if (!body) return;

        console.log(
          `[MESSAGE] ${sender}: ${body}`
        );

        // HANDLE AI SYSTEM
        await handleAlice(
          sock,
          body,
          from,
          sender,
          isGroup
        );

      } catch (err) {

        console.log(
          "Message Error:",
          err.message
        );

      }
    }
  );
}

// ======================================
// START
// ======================================

startBot();
