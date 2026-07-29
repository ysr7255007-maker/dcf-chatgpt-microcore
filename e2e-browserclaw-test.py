import requests
import json
import time

SESSION_ID = "1eccd2d8-893b-4fbc-a113-42cd1edfdd55"
URL = "http://127.0.0.1:9010/mcp"

def call_browserclaw(method, params):
    """Call BrowserClaw MCP tool"""
    msg = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 10000,
        "method": "tools/call",
        "params": {"name": method, "arguments": params}
    }
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': SESSION_ID
    }
    r = requests.post(URL, headers=headers, json=msg, timeout=15)
    for line in r.text.split('data:'):
        if 'result' in line and 'content' in line:
            try:
                data = json.loads(line.replace('retry:', '').replace('id:', '').strip())
                return data.get('result', {})
            except:
                pass
    return None

# Test 1: Grep conversation links
print("=== Test 1: Count Conversation Links via Grep ===")
result = call_browserclaw("grep", {"page": 53, "regex": "/c/[a-f0-9-]{36}"})
if result and 'content' in result:
    print(result['content'][0]['text'])
else:
    print("Error:", result)

# Test 2: Read full page markdown
print("\n=== Test 2: Full Page Content via Read ===")
result = call_browserclaw("read", {"page": 53})
if result and 'content' in result:
    content = result['content'][0]['text']
    lines = [l for l in content.split('\n') if '/c/' in l]
    print(f"Found {len(lines)} conversation links")
    print("\nFirst 5:")
    for line in lines[:5]:
        print(f"  - {line}")

# Test 3: Evaluate JavaScript for JSON output
print("\n=== Test 3: Direct JS Evaluation ===")
js_code = '''
const links = document.querySelectorAll('nav a[href^="/c/"]');
return JSON.stringify({
  url: location.href,
  totalLinks: links.length,
  links: Array.from(links).slice(0, 3).map(l => ({ text: l.textContent, href: l.href }))
});
'''
# Note: evaluate uses `code` field, not `expression`
result = call_browserclaw("evaluate", {"page": 53, "code": js_code})
if result and 'content' in result:
    text = result['content'][0].get('text', '')
    # Remove untrusted marker
    text = text.replace('[UNTRUSTED_PAGE_CONTENT ...]', '').replace('[END_UNTRUSTED_PAGE_CONTENT ...]', '')
    print(text.strip())
