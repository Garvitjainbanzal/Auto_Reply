const path = require("path");
const process = require("process");
const fs = require("fs").promises;
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");

// Get the authorization URL and redirect the user to it
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    console.log(client);
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    console.log(client)
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

// Exchange the authorization code for an access token and refresh token
async function auto_reply(auth) {
    const gmail = google.gmail({ version: "v1", auth: auth });

    // Fetch all the email threads in the user's mailbox
    const { data } = await gmail.users.threads.list({
        userId: "me",
        maxResults: 10
    });
    // Find the threads that have no prior replies
    const nonRepliedThreads = data.threads.filter(async (thread) => {
        console.log(thread);
        const { data } = await gmail.users.threads.get({
            userId: "me",
            id: thread.id
        });
        const lastMessage = data.messages[data.messages.length - 1];
        return lastMessage.labelIds.includes("INBOX") && !lastMessage.fromMe;
    });

    // Send a reply to each non-replied thread
    for (const thread of nonRepliedThreads) {
        console.log(thread.id)
        const messageId = thread.id;

        // Fetch the thread and extract the relevant information
        const { data: threadData } = await gmail.users.threads.get({
            userId: "me",
            id: messageId,
        });
        const { to, subject } = threadData.messages[0].payload.headers.reduce(
            (headers, header) => {
                if (header.name === "To") headers.to = header.value;
                if (header.name === "Subject") headers.subject = header.value;
                return headers;
            },
            {}
        );

        // Send the reply
        const message = `Thanks for your email about "${subject}"! I'm currently out of the office and will get back to you as soon as possible. Best regards, Your Name`;
        await gmail.users.messages.send({
            userId: "me",
            requestBody: {
                raw: Buffer.from(`To: ${to}\r\nSubject: Re: ${subject}\r\n\r\n${message}`).toString('base64url'),
                threadId: messageId,
            },
        });

        // Add a label to the email
        const labelName = "auto-replied";
        let labelId;
        try {
            const { data } = await gmail.users.labels.create({
                userId: "me",
                requestBody: {
                    name: labelName,
                    labelListVisibility: "labelShow",
                    messageListVisibility: "show",
                },
            });
            labelId = data.id;
        } catch (error) {
            const { data } = await gmail.users.labels.list({ userId: "me" });
            const label = data.labels.find((label) => label.name === labelName);
            labelId = label.id;
        }
        await gmail.users.messages.modify({
            userId: "me",
            id: messageId,
            requestBody: {
                addLabelIds: [labelId],
            },
        });
    }

}

function main() {
    authorize().then(auto_reply).catch(err => console.log(err.message));
    const min = 45, max = 120;
    let random_interval = Math.floor(Math.random() * (max - min + 1) + min);
    setTimeout(() => {
        main();
    }, random_interval * 1000);
}

main();