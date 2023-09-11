export interface user {
    user_email: String,
    companies: company[]
}

export interface company {
    company: String,
    tickets: ticket[]
    events: event[]
}

export interface ticket {
    ticket: String,
    summary: summary
}

export interface summary {
    body_text: String,
    user_id: String,
    user_is_agent: String,
    user_email: String,
    updated_at: String,
    ai_summary: String
}

interface event {

}