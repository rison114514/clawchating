import sys
import os
import json
import subprocess
import time
import re


def _extract_json_text(raw: str) -> str:
    """Extract the first JSON object from CLI output that may contain extra logs."""
    if not raw:
        return ""
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return ""
    return raw[start:end + 1]


def _get_agent_text(output_json: dict) -> str:
    """Support both {result:{payloads:[...]}} and {payloads:[...]} shapes."""
    payloads = []
    if isinstance(output_json, dict):
        if isinstance(output_json.get("result"), dict):
            payloads = output_json["result"].get("payloads", [])
        elif isinstance(output_json.get("payloads"), list):
            payloads = output_json.get("payloads", [])

    if payloads and isinstance(payloads[0], dict):
        return str(payloads[0].get("text", "")).strip()
    return ""


def _count_non_empty_lines(file_path: str) -> int:
    if not os.path.exists(file_path):
        return 0

    count = 0
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                count += 1
    return count

def process_file(input_path):
    filename = os.path.basename(input_path)
    output_path = input_path.replace(".txt", "_annotated.txt")
    
    # Determine type
    entity_type = "UNKNOWN"
    if "equ" in filename.lower():
        entity_type = "EQU"
    elif "per" in filename.lower():
        entity_type = "PER"
    elif "org" in filename.lower():
        entity_type = "ORG"
    
    print(f"Processing {input_path} as type {entity_type}...")

    completed_count = _count_non_empty_lines(output_path)
    write_mode = 'a' if completed_count > 0 else 'w'
    if completed_count > 0:
        print(f"Detected existing progress in {output_path}: {completed_count} line(s). Resume enabled.")
    
    try:
        with open(input_path, 'r', encoding='utf-8') as fin, open(output_path, write_mode, encoding='utf-8') as fout:
            lines = fin.readlines()
            total = len(lines)
            skipped = 0
            target_skip = completed_count
            
            for i, line in enumerate(lines):
                line = line.strip()
                if not line:
                    continue

                if skipped < target_skip:
                    skipped += 1
                    continue
                
                print(f"[{i+1}/{total}] Processing: {line}")
                
                # Construct prompt
                prompt = f"任务类型：{entity_type}\n待审核内容：{line}"
                
                # Call agent
                # Use --local to ensure it runs in the current environment context if relevant, 
                # but usually --agent is enough if gateway is running. 
                # Given previous output was redirected to file, I assume it works.
                cmd = [
                    "openclaw", "agent", 
                    "--agent", "bio-li",
                    "--message", prompt,
                    "--json",
                    "--local" 
                ]
                
                try:
                    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                    json_text = _extract_json_text(result.stdout)
                    if not json_text:
                        print(f"Warning: no JSON object found in stdout for line '{line}'")
                        fout.write(f"{line} ERROR_JSON_PARSE\n")
                        continue

                    output_json = json.loads(json_text)

                    agent_response = _get_agent_text(output_json)
                    if not agent_response:
                        # Fallbacks for rare response formats
                        if isinstance(output_json, dict) and isinstance(output_json.get("text"), str):
                            agent_response = output_json.get("text", "")
                        else:
                            agent_response = str(output_json)

                    agent_response = agent_response.replace("```", "").strip()
                    if not agent_response:
                        print(f"Warning: Empty response for line '{line}'")
                        fout.write(f"{line} ERROR_NO_RESPONSE\n")
                        continue

                    # Keep only the first valid label line: 0/1 or 2 [x] [y]
                    matched = None
                    for candidate in agent_response.splitlines():
                        candidate = candidate.strip()
                        if re.match(r"^[01]$", candidate):
                            matched = candidate
                            break
                        if re.match(r"^2(?:\s+\[[^\]]+\])+$", candidate):
                            matched = candidate
                            break

                    if matched is None:
                        # Fallback: capture leading label token from a noisy response.
                        token_match = re.search(r"\b([012])\b", agent_response)
                        matched = token_match.group(1) if token_match else "ERROR_INVALID_RESPONSE"

                    fout.write(f"{line} {matched}\n")
                    fout.flush()
                    
                except subprocess.CalledProcessError as e:
                    print(f"Error calling agent: {e}")
                    print(f"Stderr: {e.stderr}")
                    fout.write(f"{line} ERROR_CALL_FAILED\n")
                except json.JSONDecodeError as e:
                    print(f"Error parsing JSON: {e}")
                    print(f"Output was: {result.stdout}")
                    fout.write(f"{line} ERROR_JSON_PARSE\n")
                except Exception as e:
                    print(f"Unexpected error: {e}")
                    fout.write(f"{line} ERROR_UNKNOWN\n")

    except FileNotFoundError:
        print(f"File not found: {input_path}")
        sys.exit(1)

    print(f"Done. Output saved to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 annotate_entities.py <input_file>")
        sys.exit(1)
    
    process_file(sys.argv[1])
