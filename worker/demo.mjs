export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const type = response.headers.get('content-type') || '';
    if (!/(text\/html|text\/css|javascript)/i.test(type)) return response;
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-cache, must-revalidate');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
