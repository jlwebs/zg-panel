"""
ZeroGravity Proxy
=================
使用教程 (Usage Guide):
1. 启动代理:
   python3 proxy_fix.py [OPTIONS]

参数说明:
--port <number>       修改监听端口 (默认 8740)
--upstream <url>      修改上游地址 (默认 http://localhost:8741)
--debug               开启详细日志
--direct              纯透明转发模式（跳过所有处理）
--prepend-thinking    将 reasoning_content 内容流式附加到 content 前（引用块格式）

示例 (Examples):
- 默认模式: python3 proxy_fix.py
- 开启日志: python3 proxy_fix.py --debug
- 显示思考: python3 proxy_fix.py --prepend-thinking
"""

import http.server
import urllib.request
import sys
import json
import shutil

# --- 配置初始化 ---
PORT = 8740
UPSTREAM = "http://127.0.0.1:8741"
DEBUG = False
DIRECT = False
PREPEND_THINKING = False  # 将 reasoning_content 流式擅入 content

# 解析命令行参数
if "--port" in sys.argv:
    try: PORT = int(sys.argv[sys.argv.index("--port") + 1])
    except: pass
if "--upstream" in sys.argv:
    try: UPSTREAM = sys.argv[sys.argv.index("--upstream") + 1]
    except: pass
if "--debug" in sys.argv:
    DEBUG = True
if "--direct" in sys.argv:
    DIRECT = True
if "--prepend-thinking" in sys.argv:
    PREPEND_THINKING = True

def dprint(*args):
    if DEBUG:
        print(*args, flush=True)

def _make_content_chunk(obj: dict, text: str) -> bytes:
    """基于原始 SSE chunk 构造一个纯 content delta chunk，带正确的 SSE 换行"""
    import copy
    new_obj = copy.deepcopy(obj)
    for choice in new_obj.get("choices", []):
        delta = choice.get("delta", {})
        for k in list(delta.keys()):
            if k != "role":
                del delta[k]
        delta["content"] = text
    # SSE 每个事件必须以 \n\n 结尾
    return f"data: {json.dumps(new_obj, ensure_ascii=False)}\n\n".encode("utf-8")


def transform_sse_line(line: bytes, state: dict) -> list[bytes]:
    """
    将 reasoning_content delta 转换为 content delta（Markdown 引用块格式）.
    state: {
        'thinking': bool  # 当前是否处于 thinking 流
    }
    返回: 要发送的行列表（可能是原始行，也可能是替换后的多行）
    """
    if not line.startswith(b"data:"):
        return [line]
    data = line[5:].strip()
    if not data or data == b"[DONE]":
        return [line]
    try:
        obj = json.loads(data)
        choices = obj.get("choices", [])
        if not choices:
            return [line]
        delta = choices[0].get("delta", {})

        if "reasoning_content" in delta:
            rc = delta.get("reasoning_content") or ""
            if not rc:
                return []  # 空的 reasoning_content，丢弃

            out_lines = []
            if not state.get("thinking"):
                # 第一个 thinking chunk：加标题
                state["thinking"] = True
                header = _make_content_chunk(obj, "> 💭 **Thinking:**\n> ")
                out_lines.append(header)

            # 把 thinking 内容每行加 "> " 前缀并转为 content
            rc_formatted = rc.replace("\n", "\n> ")
            out_lines.append(_make_content_chunk(obj, rc_formatted))
            return out_lines

        else:
            if state.get("thinking") and delta.get("content") is not None:
                # thinking 结束，插入一个空行分隔符
                state["thinking"] = False
                sep = _make_content_chunk(obj, "\n\n")
                return [sep, line]
            return [line]
    except Exception:
        return [line]

def _debug_sse_line(line: bytes):
    """debug 模式下打印每个 SSE data 行的 delta 字段"""
    if not line.startswith(b"data:"):
        return
    data = line[5:].strip()
    if not data or data == b"[DONE]":
        return
    try:
        obj = json.loads(data)
        for choice in obj.get("choices", []):
            delta = choice.get("delta", {})
            if delta:
                # 对 content 只打长度，其他字段打前 150 字符
                summary = {}
                for k, v in delta.items():
                    if k == "content":
                        summary[k] = f"[{len(v or '')} chars]"
                    elif k == "tool_calls":
                        summary[k] = f"[{len(v or [])} calls]"
                    else:
                        summary[k] = str(v)[:150] if v else v
                if summary:
                    dprint(f"  [DELTA] {json.dumps(summary, ensure_ascii=False)}")
    except Exception:
        pass

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, format, *args):
        if DEBUG:
            super().log_message(format, *args)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def handle_request(self, method):
        url = UPSTREAM.rstrip("/") + self.path

        # 准备 Headers
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "connection", "accept-encoding")}
        headers["Accept-Encoding"] = "identity"  # 禁用压缩，确保可以逐字节转发
        headers["Connection"] = "close"

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        if DEBUG and method == "POST":
            dprint(f"\n[REQ POST] {self.path}")
            dprint(f"  [HEADERS] {json.dumps(dict(self.headers))}")
            if body:
                try:
                    bj = json.loads(body)
                    info = {
                        "model": bj.get("model"),
                        "stream": bj.get("stream"),
                        "keys": list(bj.keys()),
                        "tools": len(bj.get("tools", [])),
                        "msgs": len(bj.get("messages", [])),
                        "size": len(body),
                        "max_tokens": bj.get("max_tokens") or bj.get("max_completion_tokens"),
                        "temperature": bj.get("temperature"),
                    }
                    dprint(f"  [BODY] {json.dumps(info)}")
                    # 打印 system prompt 的前 200 字符
                    msgs = bj.get("messages", [])
                    if msgs and msgs[0].get("role") == "system":
                        sys_content = str(msgs[0].get("content", ""))[:200]
                        dprint(f"  [SYS_PROMPT] {sys_content}...")
                except Exception:
                    dprint(f"  [BODY] raw size={len(body)}")

        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.send_response(resp.status)

                resp_ct = resp.headers.get("Content-Type", "").lower()
                is_sse = "text/event-stream" in resp_ct

                # 透传响应头
                for k, v in resp.headers.items():
                    if k.lower() in ("access-control-allow-origin", "connection",
                                     "transfer-encoding", "content-length"):
                        continue
                    self.send_header(k, v)

                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Connection', 'close')

                if is_sse:
                    self.send_header('Cache-Control', 'no-cache')
                    self.send_header('X-Accel-Buffering', 'no')

                self.end_headers()

                # 转发响应体
                if DIRECT or not is_sse:
                    shutil.copyfileobj(resp, self.wfile)
                else:
                    # SSE：逐行处理，支持 thinking 注入和 debug 日志
                    line_buf = b""
                    think_state = {"thinking": False}  # 每个请求独立状态
                    while True:
                        chunk = resp.read(1)
                        if not chunk:
                            if line_buf:
                                if DEBUG: _debug_sse_line(line_buf)
                                out = transform_sse_line(line_buf, think_state) if PREPEND_THINKING else [line_buf]
                                for l in out:
                                    try: self.wfile.write(l); self.wfile.flush()
                                    except: break
                            break
                        line_buf += chunk
                        if chunk == b"\n":
                            if DEBUG: _debug_sse_line(line_buf)
                            out = transform_sse_line(line_buf, think_state) if PREPEND_THINKING else [line_buf]
                            for l in out:
                                try: self.wfile.write(l); self.wfile.flush()
                                except: break
                            line_buf = b""


        except Exception as e:
            dprint(f"  !! [ERR] {e}")
            if not self.wfile.closed:
                try:
                    self.send_response(502)
                    self.end_headers()
                except:
                    pass

    def do_GET(self): self.handle_request("GET")
    def do_POST(self): self.handle_request("POST")
    def do_DELETE(self): self.handle_request("DELETE")
    def do_PATCH(self): self.handle_request("PATCH")
    def do_PUT(self): self.handle_request("PUT")

if __name__ == "__main__":
    debug_str = "[DEBUG]" if DEBUG else ""
    direct_str = "[DIRECT]" if DIRECT else ""
    print(f"Proxy starting {debug_str}{direct_str} on :{PORT} -> {UPSTREAM}", flush=True)
    try:
        http.server.HTTPServer(('', PORT), ProxyHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopping proxy...")
