const express = require("express");
const fs = require("fs");
const path = require("path");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const P = require("pino");

// =========================
// EXPRESS SERVER
// =========================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("WhatsApp Bot Running");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// =========================
// PERSISTENT USER STORAGE
// =========================

const USERS_FILE = path.join(__dirname, "users.json");

function loadUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(
                USERS_FILE,
                JSON.stringify([], null, 2)
            );

            return new Set();
        }

        const data = fs.readFileSync(
            USERS_FILE,
            "utf8"
        );

        const users = JSON.parse(data);

        if (!Array.isArray(users)) {
            return new Set();
        }

        return new Set(users);

    } catch (error) {

        console.error(
            "Could not load users.json:",
            error
        );

        return new Set();
    }
}

function saveUsers(users) {
    try {

        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(
                Array.from(users),
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            "Could not save users.json:",
            error
        );
    }
}

const users = loadUsers();

console.log(
    `Loaded ${users.size} saved user(s).`
);

// =========================
// MESSAGE STORAGE
// =========================

const messageStore = new Map();

let reconnecting = false;

// =========================
// START BOT
// =========================

async function startBot() {

    try {

        const { state, saveCreds } =
            await useMultiFileAuthState(
                "auth_info"
            );

        const sock = makeWASocket({

            auth: state,

            logger: P({
                level: "silent"
            }),

            printQRInTerminal: false
        });

        sock.ev.on(
            "creds.update",
            saveCreds
        );

        // =========================
        // CONNECTION
        // =========================

        sock.ev.on(
            "connection.update",
            (update) => {

                const {
                    connection,
                    lastDisconnect,
                    qr
                } = update;

                console.log(
                    "Connection update:",
                    connection || "waiting..."
                );

                // QR CODE
                if (qr) {

                    console.log("");
                    console.log(
                        "=============================="
                    );
                    console.log(
                        "       WHATSAPP QR CODE"
                    );
                    console.log(
                        "=============================="
                    );

                    qrcode.generate(
                        qr,
                        {
                            small: true
                        }
                    );

                    console.log(
                        "=============================="
                    );
                    console.log(
                        "Scan this QR with WhatsApp."
                    );
                    console.log(
                        "=============================="
                    );
                    console.log("");
                }

                // CONNECTED
                if (connection === "open") {

                    reconnecting = false;

                    console.log("");
                    console.log(
                        "WhatsApp Bot Connected ✅"
                    );
                    console.log(
                        `Saved users: ${users.size}`
                    );
                    console.log("");
                }

                // CLOSED
                if (connection === "close") {

                    const statusCode =
                        lastDisconnect?.error
                            ?.output?.statusCode;

                    console.log(
                        "WhatsApp connection closed."
                    );

                    console.log(
                        "Disconnect status:",
                        statusCode
                    );

                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {

                        console.log(
                            "WhatsApp session logged out."
                        );

                        console.log(
                            "Delete auth_info and restart the bot."
                        );

                        return;
                    }

                    if (!reconnecting) {

                        reconnecting = true;

                        console.log(
                            "Reconnecting in 3 seconds..."
                        );

                        setTimeout(
                            () => {

                                reconnecting = false;

                                startBot();

                            },
                            3000
                        );
                    }
                }
            }
        );

        // =========================
        // MESSAGE HANDLER
        // =========================

        sock.ev.on(
            "messages.upsert",
            async ({ messages }) => {

                try {

                    const msg = messages[0];

                    if (
                        !msg ||
                        !msg.message
                    ) {
                        return;
                    }

                    const jid =
                        msg.key.remoteJid;

                    const text =
                        msg.message.conversation ||
                        msg.message
                            .extendedTextMessage
                            ?.text ||
                        "";

                    // Save message
                    messageStore.set(
                        msg.key.id,
                        {
                            jid,
                            text
                        }
                    );

                    // Ignore bot's own messages
                    if (msg.key.fromMe) {
                        return;
                    }

                    const command =
                        text
                            .trim()
                            .split(/\s+/)[0]
                            .toLowerCase();

                    // =========================
                    // !HELP
                    // =========================

                    if (command === "!help") {

                        await sock.sendMessage(
                            jid,
                            {
                                text:
`WhatsApp Bot Commands:

!help
!status
!id
!send message
!add number
!remove number
!list
!promote
!demote`
                            }
                        );

                        return;
                    }

                    // =========================
                    // !STATUS
                    // =========================

                    if (command === "!status") {

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    "Bot is running ✅"
                            }
                        );

                        return;
                    }

                    // =========================
                    // !ID
                    // =========================

                    if (command === "!id") {

                        await sock.sendMessage(
                            jid,
                            {
                                text:
`Chat ID:

${jid}`
                            }
                        );

                        return;
                    }

                    // =========================
                    // !SEND
                    // =========================

                    if (command === "!send") {

                        const sendText =
                            text
                                .replace(
                                    /^!send\s*/i,
                                    ""
                                )
                                .trim();

                        if (!sendText) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "Usage: !send your message"
                                }
                            );

                            return;
                        }

                        await sock.sendMessage(
                            jid,
                            {
                                text: sendText
                            }
                        );

                        return;
                    }

                    // =========================
                    // !ADD
                    // =========================

                    if (command === "!add") {

                        const parts =
                            text
                                .trim()
                                .split(/\s+/);

                        const number =
                            parts[1];

                        if (!number) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "Usage: !add 254712345678"
                                }
                            );

                            return;
                        }

                        if (users.has(number)) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `${number} is already added.`
                                }
                            );

                            return;
                        }

                        users.add(number);

                        // SAVE TO FILE
                        saveUsers(users);

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    `Added ${number} and saved permanently ✅`
                            }
                        );

                        return;
                    }

                    // =========================
                    // !REMOVE
                    // =========================

                    if (command === "!remove") {

                        const parts =
                            text
                                .trim()
                                .split(/\s+/);

                        const number =
                            parts[1];

                        if (!number) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "Usage: !remove 254712345678"
                                }
                            );

                            return;
                        }

                        if (!users.has(number)) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `${number} is not in the list.`
                                }
                            );

                            return;
                        }

                        users.delete(number);

                        // SAVE UPDATED LIST
                        saveUsers(users);

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    `Removed ${number} permanently ✅`
                            }
                        );

                        return;
                    }

                    // =========================
                    // !LIST
                    // =========================

                    if (command === "!list") {

                        if (users.size === 0) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "No users have been added."
                                }
                            );

                            return;
                        }

                        const list =
                            Array.from(users)
                                .map(
                                    (number, index) =>
                                        `${index + 1}. ${number}`
                                )
                                .join("\n");

                        await sock.sendMessage(
                            jid,
                            {
                                text:
`Saved users:

${list}

Total: ${users.size}`
                            }
                        );

                        return;
                    }

                    // =========================
                    // !PROMOTE
                    // =========================

                    if (command === "!promote") {

                        if (
                            jid &&
                            jid.endsWith("@g.us")
                        ) {

                            const participant =
                                msg.key.participant;

                            if (!participant) {
                                return;
                            }

                            await sock.groupParticipantsUpdate(
                                jid,
                                [
                                    participant
                                ],
                                "promote"
                            );

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "User promoted ✅"
                                }
                            );
                        }

                        return;
                    }

                    // =========================
                    // !DEMOTE
                    // =========================

                    if (command === "!demote") {

                        if (
                            jid &&
                            jid.endsWith("@g.us")
                        ) {

                            const participant =
                                msg.key.participant;

                            if (!participant) {
                                return;
                            }

                            await sock.groupParticipantsUpdate(
                                jid,
                                [
                                    participant
                                ],
                                "demote"
                            );

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "User demoted ✅"
                                }
                            );
                        }

                        return;
                    }

                } catch (error) {

                    console.error(
                        "Message handler error:",
                        error
                    );
                }
            }
        );

        // =========================
        // DELETED MESSAGE
        // =========================

        sock.ev.on(
            "messages.update",
            async (updates) => {

                for (const update of updates) {

                    try {

                        if (
                            update.update &&
                            update.update.message === null
                        ) {

                            const old =
                                messageStore.get(
                                    update.key.id
                                );

                            if (
                                old &&
                                old.text
                            ) {

                                await sock.sendMessage(
                                    old.jid,
                                    {
                                        text:
`Deleted message recovered:

${old.text}`
                                    }
                                );
                            }
                        }

                    } catch (error) {

                        console.error(
                            "Deleted message handler error:",
                            error
                        );
                    }
                }
            }
        );

    } catch (error) {

        console.error(
            "Bot startup error:",
            error
        );

        setTimeout(
            startBot,
            5000
        );
    }
}

// =========================
// START
// =========================

console.log(
    "Starting WhatsApp Bot..."
);

startBot();
