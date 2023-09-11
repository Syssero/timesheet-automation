//import axios from "axios";
const axios = require('axios');
const { string } = require('joi');
/*const Joi = require('joi');

const user = Joi.object([{
    user: [{
        user_email: Joi.string().email,
        companies: [{
            company: Joi.string(),
            tickets: [{
                ticket: Joi.string(),
                comments: [{
                    body_text: Joi.string(),
                    user_id: Joi.string(),
                    user_is_agent: Joi.string(),
                    user_email: Joi.string(),
                    updated_at: Joi.string(),
                    ai_summary: Joi.string()
                }]
            }]
        }]
    }]
}])*/

const ticketSummary = async (req, res) => {
    console.log('ticketSummary function called')
    var date = new Date();
    date.setDate(date.getDate() - 1);
    date = date.toISOString().slice(0, 10);
    console.log(`date: ${date}`);
    /* let groupedConversations = [{
         user: [{
             user_email: string,
             companies: [{
                 company: string,
                 tickets: [{
                     ticket: string,
                     comments: [{
                         body_text: string,
                         user_id: string,
                         user_is_agent: string,
                         user_email: string,
                         updated_at: string,
                         ai_summary: string
                     }]
                 }]
             }]
         }]
     }];*/

    let groupedConversations = {};

    const FRESHDESK_BASE_URL = 'https://syssero.freshdesk.com/api';
    const FRESHDESK_API_KEY = '7X7LVMNBCxZZDz4DXyQN';
    const AZURE_OPENAI_URL = 'https://freshdesk-comments-summary.openai.azure.com/openai/deployments/gpt-35-turbo-4k/chat/completions?api-version=2023-05-15';
    const AZURE_OPENAI_API_KEY = '58fc8058363744c1b42cc078d0fb3d6a';
    const PER_PAGE = 100; // Maximum allowed by Freshdesk API
    let apiCallsCount = 0; // Counter for API calls

    // Function to fetch paginated data
    const fetchPaginatedData = async (url, params = {}) => {
        let page = 1;
        let aggregatedData = [];

        while (true) {
            apiCallsCount++; // Increase the counter with each API call
            const response = await axios.get(
                `${url}?page=${page}&per_page=${PER_PAGE}`,
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString(
                            "base64"
                        )}`,
                    },
                    params,
                }
            );

            aggregatedData = [...aggregatedData, ...response.data];

            // If the number of results is less than the maximum, we've reached the last page
            if (response.data.length < PER_PAGE) {
                break;
            }

            page++;
        }

        return aggregatedData;
    };

    // Fetch all companies
    const companies = await fetchPaginatedData(
        `${FRESHDESK_BASE_URL}/v2/companies`
    );
    const companyMap = companies.reduce(
        (map, company) => ({ ...map, [company.id]: company.name }),
        {}
    );

    // Fetch all agents
    const agents = await fetchPaginatedData(
        `${FRESHDESK_BASE_URL}/v2/agents`
    );
    const agentMap = agents.reduce(
        (map, agent) => ({ ...map, [agent.id]: agent.contact.email }),
        {}
    );

    // Fetch tickets updated since the provided date
    const tickets = await fetchPaginatedData(
        `${FRESHDESK_BASE_URL}/v2/tickets`,
        { updated_since: date }
    );

    for (const ticket of tickets) {
        const conversations = await fetchPaginatedData(
            `${FRESHDESK_BASE_URL}/v2/tickets/${ticket.id}/conversations`
        );

        console.log(`ticket id: ${ticket.id}`);

        ticket.company_name = companyMap[ticket.company_id] || "N/A";

        console.log(`ticket company name: ${ticket.company_name}`);

        let phrases = [
            "thanks",
            "best regards",
            "happy Monday",
            "happy Friday",
            "cheers",
            "thank you!",
            "have a great",
            "have a good",
            "enjoy your",
            "no worries",
            "good morning",
            "good day"
        ];

        let default_messages = [
            "please see the comments below.",
            "please see the comments above.",
            "Any comments or status updates to the ticket will be accessible via the Syssero AMS Customer Portal.",
            "Please let us know if you have any questions.  Thank You!  Syssero Support Solutions",
            "https://support.syssero.com/helpdesk/tickets/"
        ]
        let pattern = phrases
            .map((phrase) => phrase.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"))
            .join("|");

        let pattern_default = default_messages
            .map((phrase) => phrase.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        let regex = new RegExp(`\\s*(?:${pattern})[\\s\\S]*`, "im");
        let regex_default = new RegExp(`${pattern_default}`, "gi");

        for (const agent of agents) {
            //console.log(`agent id: ${agent.id}`)
            // Add conversations to the ticket, filtering out conversations not updated since the provided date
            ticket.conversations = conversations
                .filter(
                    (conversation) =>
                        new Date(conversation.updated_at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) &&
                        conversation.user_id === agent.id
                )
                .map((conversation) => {
                    // Remove the undesired phrases from the body_text
                    let cleanedBodyText = conversation.body_text.replace(regex, "");
                    cleanedBodyText = cleanedBodyText.replace(regex_default, "");
                    console.log(`cleaned body text: ${cleanedBodyText}`)
                    return {
                        body_text: cleanedBodyText,
                        user_id: conversation.user_id,
                        user_is_agent: !!agentMap[conversation.user_id],
                        user_email: agentMap[conversation.user_id] || "N/A",
                        updated_at: conversation.updated_at,
                    };
                });

            //console.log(`ticket conversations: ${ticket.conversations}`)

            // Check if there are any conversations left for this ticket after filtering
            // If not, skip to the next ticket
            if (ticket.conversations.length === 0) {
                continue;
            }

            // Group conversations by date and combine the body_text
            let groupedConversationsByDate = {};

            for (let conversation of ticket.conversations) {
                let dateKey = new Date(conversation.updated_at)
                    .toISOString()
                    .slice(0, 10); // Extract just the date part

                // If the date key doesn't exist in the map, create it
                if (!groupedConversationsByDate[dateKey]) {
                    groupedConversationsByDate[dateKey] = {
                        body_text: "",
                        user_id: conversation.user_id,
                        user_is_agent: conversation.user_is_agent,
                        user_email: conversation.user_email,
                        updated_at: dateKey,
                    };
                }

                // Append the new conversation to the existing conversations for that date
                groupedConversationsByDate[
                    dateKey
                ].body_text += `message at ${conversation.updated_at}: ${conversation.body_text}\n`;
                console.log(`body text: ${conversation.body_text}`);
            }

            // Convert the groupedConversationsByDate object into an array
            ticket.conversations = Object.values(groupedConversationsByDate);

            // Request to OpenAI's Chat Model API
            for (let conversation of ticket.conversations) {
                console.log(`conversation: ${conversation}`);
                const prompt = `You are a consultant reviewing your notes and messages to your clients. You need to use this information to write what you did during that day so your client can approve your time. Your summary should be less that 500 characters (counting spaces) and you should give a narative. Answer using markdown code.\n\nBeginning of message: ${conversation.body_text}`;
                const response = await axios.post(
                    `${AZURE_OPENAI_URL}`,
                    {
                        messages: [
                            {
                                role: "user",
                                content: prompt,
                            },
                        ],
                        temperature: 0.3,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "api-key": `${AZURE_OPENAI_API_KEY}`,
                        },
                    }
                );

                conversation.ai_summary = response.data.choices[0].message.content;
            }

            // Group the conversations by date, then by company, then by ticket number
            for (let conversation of ticket.conversations) {
                //const dateKey = conversation.updated_at; // Extract the date part
                const companyKey = ticket.company_name;
                const ticketKey = ticket.id.toString();
                const agentKey = agentMap[conversation.user_id];
                console.log(`agentKey: ${agentKey}`)

                /*if(!groupedConversations.user || groupedConversations.user.user_email != agentKey) {
                    groupedConversations.user = {
                        user_email: agentKey    
                    }
                } else {
                    //groupedConversations.user = 
                }
                console.log(`user email: ${groupedConversations.user.user_email}`)*/
                if (!groupedConversations[agentKey]) {
                    groupedConversations[agentKey] = {};
                }
                if (!groupedConversations[agentKey][companyKey]) {
                    groupedConversations[agentKey][companyKey] = {};
                }
                if (!groupedConversations[agentKey][companyKey][ticketKey]) {
                    groupedConversations[agentKey][companyKey][ticketKey] = {};
                }
                groupedConversations[agentKey][companyKey][ticketKey] = conversation;
            }

        }
    }

    const inputData = groupedConversations; // Your original JSON output

    const transformedData = Object.entries(inputData).map(([user_email, companiesData]) => {
        const companies = Object.entries(companiesData).map(([company_name, ticketsData]) => {
            const tickets = Object.entries(ticketsData).map(([ticket, ticketDetails]) => {
                // Assuming there's only one summary per ticket for simplicity
                const summary = ticketDetails;
                return {
                    ticket,
                    summary
                };
            });
            return {
                company_name,
                tickets
            };
        });
        return {
            user_email,
            companies
        };
    });

    console.log(transformedData);

    console.log(`Total API calls made: ${apiCallsCount}`); // Log the number of API calls made
    console.log(`groupedConversations: ${groupedConversations}`);
    res.json(transformedData);
    console.log(`respose: ${res}`)
    return res;
};

module.exports = ticketSummary;