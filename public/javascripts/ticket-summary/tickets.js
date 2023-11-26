//import axios from "axios";
const axios = require('axios');
//const { string } = require('joi');
//const moment = require('moment');

    const ticketSummary = async (req, res) => {
        var ticketDate = new Date();
        ticketDate.setDate(ticketDate.getDate() - 2);
        ticketDate = ticketDate.toISOString().slice(0, 10);

        var conversationDate = new Date();
        conversationDate.setDate(conversationDate.getDate() - 1);
        conversationDate = conversationDate.toLocaleString("en-US", {timeZone: "America/New_York"}).slice(0, 10);

        let groupedConversations = {};

        const FRESHDESK_BASE_URL = 'https://syssero.freshdesk.com/api';
        const FRESHDESK_API_KEY = req.query.fdKey;
        const AZURE_OPENAI_URL = 'https://freshdesk-comments-summary.openai.azure.com/openai/deployments/gpt-35-turbo-4k/chat/completions?api-version=2023-05-15';
        const AZURE_OPENAI_API_KEY = req.query.aoaiKey;
        const agentList = req.query.agents;
        const agentArr = agentList.split(",");
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

        // Function to fetch paginated data
        const fetchAgentData = async (url, params = {}) => {
            let aggregatedData = [];
            for(const agent of agentArr) {
                const response = await axios.get(
                    `${FRESHDESK_BASE_URL}/v2/agents?email=${agent}`,
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
        const companyDomainMap = companies.reduce(
            (map, company) => ({ ...map, [company.name]: company.domains }),
            {}
        );

        // Fetch agents info
        const agents = await fetchAgentData();
        const agentMap = agents.reduce(
            (map, agent) => ({ ...map, [agent.id]: agent.contact.email }),
            {}
        );

        const agentNameMap = agents.reduce(
            (map, agent) => ({ ...map, [agent.contact.email]: agent.contact.name }),
            {}
        );

        // Fetch tickets updated since the provided date
        const tickets = await fetchPaginatedData(
            `${FRESHDESK_BASE_URL}/v2/tickets`,
            { updated_since: ticketDate }
        );

        const ticketSubjectMap = tickets.reduce(
            (map, ticket) => ({ ...map, [ticket.id]: ticket.subject }),
            {}
        );

        for (const ticket of tickets) {
            const conversations = await fetchPaginatedData(
                `${FRESHDESK_BASE_URL}/v2/tickets/${ticket.id}/conversations`
            );

            ticket.company_name = companyMap[ticket.company_id] || "N/A";        
            
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

            let summary_defaults = [
                "Reviwed",
                "Reviewed and responded",
                "Reviewed with",
                "Closed"
            ]

            let pattern = phrases
                .map((phrase) => phrase.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"))
                .join("|");

            let pattern_default = default_messages
                .map((phrase) => phrase.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"))
                .join("|");

            let pattern_summary_default = summary_defaults
                .map((phrase) => phrase.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"))
                .join("|");

            let regex = new RegExp(`\\s*(?:${pattern})[\\s\\S]*`, "im");
            let regex_default = new RegExp(`${pattern_default}`, "gi");

            for (const agent of agents) {
                // Add conversations to the ticket, filtering out conversations not updated since the provided date
                ticket.conversations = conversations
                    .filter(
                        (conversation) =>
                            new Date(conversation.updated_at).toLocaleString("en-US", {timeZone: "America/New_York"}).slice(0, 10) === conversationDate &&
                            conversation.user_id === agent.id &&
                            (conversation.private === false || (conversation.private === true && 
                                conversation.body_text.toUpperCase().includes('TIME NOTES')))
                    )
                    .map((conversation) => {
                        // Remove the undesired phrases from the body_text
                        let cleanedBodyText = conversation.body_text.replace(regex, "");
                        cleanedBodyText = cleanedBodyText.replace(regex_default, "");
                        return {
                            body_text: cleanedBodyText,
                            user_id: conversation.user_id,
                            user_is_agent: !!agentMap[conversation.user_id],
                            user_email: agentMap[conversation.user_id] || "N/A",
                            updated_at: conversation.updated_at,
                        };
                    });

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
                }

                // Convert the groupedConversationsByDate object into an array
                ticket.conversations = Object.values(groupedConversationsByDate);

                // Request to OpenAI's Chat Model API
                for (let conversation of ticket.conversations) {
                    const prompt = `You are a consultant reviewing your replies to your tickets. You need to use this information to write what you did on the ticket. You do not need to mention the ticket number in the summary. Your summary should be less that 200 characters (counting spaces) and you should use bullet points. Answer using markdown code.\n\nBeginning of message: ${conversation.body_text} ${conversation.body_text}`;
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
                const company_domain = companyDomainMap[company_name] || "N/A";
                const tickets = Object.entries(ticketsData).map(([ticket, ticketDetails]) => {
                    // Assuming there's only one summary per ticket for simplicity
                    const summary = ticketDetails;
                    const subject = ticketSubjectMap[ticket];
                    return {
                        ticket,
                        subject,
                        summary
                    };
                });
                return {
                    company_name,
                    company_domain,
                    tickets
                };
            });
            const user_name = agentNameMap[user_email];
            return {
                user_email,
                user_name,
                companies
            };
        });

        console.log(transformedData);

        console.log(`Total API calls made: ${apiCallsCount}`); // Log the number of API calls made
        res.json(transformedData);
        return res;
};

module.exports = ticketSummary;