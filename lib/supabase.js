const { createClient } = require('@supabase/supabase-js');
function client() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const error = new Error('Supabase environment variables are not configured.');
        error.statusCode = 503;
        throw error;
    }
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function json(response, status, payload) { response.status(status).setHeader('Cache-Control', 'no-store').json(payload); }
function fail(response, error) { console.error(error); json(response, error.statusCode || 500, { error: error.message || 'Server error.' }); }
function body(request) { return typeof request.body === 'object' ? request.body : JSON.parse(request.body || '{}'); }
module.exports = { client, json, fail, body };
