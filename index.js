const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("WhatsApp Bot Running");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const P = require("pino");

const users = new Set();
const messageStore = new Map();


async function startBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState("auth_info");


    const sock = makeWASocket({

        auth: state,

        logger: P({
            level: "silent"
        })

    });


    sock.ev.on(
        "creds.update",
        saveCreds
    );


    sock.ev.on(
        "connection.update",
        (update)=>{

            const {
                connection,
                lastDisconnect,
                qr
            } = update;


            if(qr){

                qrcode.generate(
                    qr,
                    {small:true}
                );

                console.log(
                    "Scan QR code with WhatsApp"
                );
            }


            if(connection==="open"){

                console.log(
                    "WhatsApp Bot Connected ✅"
                );

            }


            if(connection==="close"){

                const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode
                !== DisconnectReason.loggedOut;


                console.log(
                    "Connection closed"
                );


                if(shouldReconnect){

                    startBot();

                }

            }

        }
    );



    // Store messages for anti-delete

    sock.ev.on(
        "messages.upsert",
        async ({messages})=>{


        const msg = messages[0];


        if(!msg.message)
            return;


        const jid = msg.key.remoteJid;


        const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";


        // Save message

        messageStore.set(
            msg.key.id,
            {
                jid,
                text
            }
        );



        // Ignore own messages

        if(msg.key.fromMe)
            return;



        const command =
        text.trim().split(" ")[0];



        switch(command){


        case "!help":

            await sock.sendMessage(
                jid,
                {
                    text:
`WhatsApp Bot Commands:

!help
!status
!send message
!add number
!remove number
!promote
!demote`
                }
            );

        break;



        case "!status":

            await sock.sendMessage(
                jid,
                {
                    text:
                    "Bot is running ✅"
                }
            );

        break;




        case "!send":

            const sendText =
            text.replace(
                "!send",
                ""
            ).trim();


            await sock.sendMessage(
                jid,
                {
                    text:sendText
                }
            );

        break;




        case "!add":

            const addNumber =
            text.split(" ")[1];


            if(addNumber){

                users.add(addNumber);


                await sock.sendMessage(
                    jid,
                    {
                        text:
                        `Added ${addNumber} ✅`
                    }
                );

            }

        break;





        case "!remove":

            const removeNumber =
            text.split(" ")[1];


            users.delete(removeNumber);


            await sock.sendMessage(
                jid,
                {
                    text:
                    `Removed ${removeNumber}`
                }
            );

        break;





        case "!promote":


            if(jid.endsWith("@g.us")){


                const participant =
                msg.key.participant;


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

        break;





        case "!demote":


            if(jid.endsWith("@g.us")){


                const participant =
                msg.key.participant;


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
                        "User demoted"
                    }
                );

            }


        break;



        }


        });



    // Detect deleted messages

    sock.ev.on(
        "messages.update",
        async updates=>{


        for(const update of updates){


            if(
                update.update.message === null
            ){

                const old =
                messageStore.get(
                    update.key.id
                );


                if(old){


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


        }


    });



}


startBot();
