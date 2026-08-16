const express = require("express");
const fs = require("fs");
const path = require("path");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const P = require("pino");

// ==========================================
// EXPRESS SERVER
// ==========================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("WhatsApp Bot Running");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ==========================================
// FILE PATHS
// ==========================================

// Keep everything beside pt.js
const AUTH_DIR = path.join(
    __dirname,
    "auth_info"
);

const USERS_FILE = path.join(
    __dirname,
    "users.json"
);

// ==========================================
// PERSISTENT USERS
// ==========================================

function loadUsers() {

    try {

        if (!fs.existsSync(USERS_FILE)) {

            fs.writeFileSync(
                USERS_FILE,
                JSON.stringify([], null, 2)
            );

            return new Set();
        }

        const data =
            fs.readFileSync(
                USERS_FILE,
                "utf8"
            );

        const savedUsers =
            JSON.parse(data);

        if (!Array.isArray(savedUsers)) {
            return new Set();
        }

        return new Set(savedUsers);

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

// ==========================================
// MESSAGE STORAGE
// ==========================================

const messageStore = new Map();

// Prevent multiple reconnect loops
let reconnectTimer = null;

// ==========================================
// START BOT
// ==========================================

async function startBot() {

    try {

        console.log("");
        console.log(
            "Starting WhatsApp connection..."
        );

        // ======================================
        // FETCH CURRENT WHATSAPP WEB VERSION
        // ======================================

        let version;

        try {

            const result =
                await fetchLatestBaileysVersion();

            version = result.version;

            console.log(
                "WhatsApp Web version:",
                version.join(".")
            );

            console.log(
                "Version reported latest:",
                result.isLatest
            );

        } catch (error) {

            console.log(
                "Could not fetch latest WA version."
            );

            console.log(
                "Using Baileys default version."
            );
        }

        // ======================================
        // AUTHENTICATION
        // ======================================

        const {
            state,
            saveCreds
        } =
            await useMultiFileAuthState(
                AUTH_DIR
            );

        // ======================================
        // SOCKET OPTIONS
        // ======================================

        const socketOptions = {

            auth: state,

            logger: P({
                level: "silent"
            }),

            // IMPORTANT:
            // Advertise as a web browser.
            // This avoids the current Windows/DARWIN
            // WebSubPlatform 428 issue.

            browser:
                Browsers.ubuntu("Chrome"),

            printQRInTerminal: false,

            markOnlineOnConnect: false,

            syncFullHistory: false
        };

        // Only add version if successfully fetched
        if (version) {
            socketOptions.version = version;
        }

        const sock =
            makeWASocket(socketOptions);

        // ======================================
        // SAVE CREDENTIALS
        // ======================================

        sock.ev.on(
            "creds.update",
            saveCreds
        );

        // ======================================
        // CONNECTION UPDATE
        // ======================================

        sock.ev.on(
            "connection.update",
            async (update) => {

                const {
                    connection,
                    lastDisconnect,
                    qr
                } = update;

                console.log(
                    "Connection update:",
                    connection || "waiting..."
                );

                // ==================================
                // QR CODE
                // ==================================

                if (qr) {

                    console.log("");
                    console.log(
                        "================================"
                    );
                    console.log(
                        "       WHATSAPP QR CODE"
                    );
                    console.log(
                        "================================"
                    );
                    console.log("");

                    qrcode.generate(
                        qr,
                        {
                            small: true
                        }
                    );

                    console.log("");
                    console.log(
                        "================================"
                    );
                    console.log(
                        "Scan this QR with WhatsApp."
                    );
                    console.log(
                        "WhatsApp > Linked devices >"
                    );
                    console.log(
                        "Link a device"
                    );
                    console.log(
                        "================================"
                    );
                    console.log("");
                }

                // ==================================
                // CONNECTED
                // ==================================

                if (connection === "open") {

                    console.log("");
                    console.log(
                        "================================"
                    );
                    console.log(
                        " WhatsApp Bot Connected ✅"
                    );
                    console.log(
                        "================================"
                    );

                    console.log(
                        `Saved users: ${users.size}`
                    );

                    console.log("");
                }

                // ==================================
                // CONNECTION CLOSED
                // ==================================

                if (connection === "close") {

                    const statusCode =
                        lastDisconnect
                            ?.error
                            ?.output
                            ?.statusCode;

                    console.log("");
                    console.log(
                        "WhatsApp connection closed."
                    );

                    console.log(
                        "Disconnect status:",
                        statusCode
                    );

                    // ==================================
                    // LOGGED OUT
                    // ==================================

                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {

                        console.log("");
                        console.log(
                            "WhatsApp session is logged out."
                        );

                        console.log(
                            `Auth folder: ${AUTH_DIR}`
                        );

                        console.log(
                            "Delete auth_info only if you"
                        );

                        console.log(
                            "want to create a completely"
                        );

                        console.log(
                            "new WhatsApp session."
                        );

                        return;
                    }

                    // ==================================
                    // DON'T CREATE MULTIPLE TIMERS
                    // ==================================

                    if (reconnectTimer) {
                        return;
                    }

                    console.log(
                        "Reconnecting in 5 seconds..."
                    );

                    reconnectTimer =
                        setTimeout(
                            () => {

                                reconnectTimer =
                                    null;

                                startBot();

                            },
                            5000
                        );
                }
            }
        );

        // ======================================
        // MESSAGE HANDLER
        // ======================================

        sock.ev.on(
            "messages.upsert",
            async ({ messages }) => {

                try {

                    const msg =
                        messages[0];

                    if (
                        !msg ||
                        !msg.message
                    ) {
                        return;
                    }

                    const jid =
                        msg.key.remoteJid;

                    // ==================================
                    // GET MESSAGE TEXT
                    // ==================================

                    const text =
                        msg.message.conversation ||
                        msg.message
                            .extendedTextMessage
                            ?.text ||
                        "";

                    // ==================================
                    // SAVE MESSAGE
                    // ==================================

                    messageStore.set(
                        msg.key.id,
                        {
                            jid,
                            text
                        }
                    );

                    // Ignore own messages
                    if (msg.key.fromMe) {
                        return;
                    }

                    const command =
                        text
                            .trim()
                            .split(/\s+/)[0]
                            .toLowerCase();

                    // ==================================
                    // !HELP
                    // ==================================

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

                    // ==================================
                    // !STATUS
                    // ==================================

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

                    // ==================================
                    // !ID
                    // ==================================

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

                    // ==================================
                    // !SEND
                    // ==================================

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

                    // ==================================
                    // !ADD
                    // ==================================

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

                    // ==================================
                    // !REMOVE
                    // ==================================

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

                    // ==================================
                    // !LIST
                    // ==================================

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

                    // ==================================
                    // !PROMOTE
                    // ==================================

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

                    // ==================================
                    // !DEMOTE
                    // ==================================

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

        // ======================================
        // DELETED MESSAGE HANDLER
        // ======================================

        sock.ev.on(
            "messages.update",
            async (updates) => {

                for (
                    const update of updates
                ) {

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

        console.error("");
        console.error(
            "BOT STARTUP ERROR:"
        );
        console.error(error);
        console.error("");

        console.log(
            "Retrying in 5 seconds..."
        );

        setTimeout(
            startBot,
            5000
        );
    }
}

// ==========================================
// START
// ==========================================

console.log("");
console.log(
    "================================"
);
console.log(
    "       Starting WhatsApp Bot"
);
console.log(
    "================================"
);
console.log("");

startBot();
