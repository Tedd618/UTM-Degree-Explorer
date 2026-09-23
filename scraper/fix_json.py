import json

file_path = "data/programs_structured.json"
with open(file_path, "r", encoding="utf-8") as f:
    data = json.load(f)

for prog in data:
    if prog.get("code") in ("ERSPE1688", "ERMAJ1688"):
        for group in prog["completion"]["groups"]:
            if group["label"] == "First Year":
                if len(group["items"]) > 3:
                    # Items 0, 1, 2 are Path A. Items 3, 4, 5 are Path B.
                    path_a = group["items"][0:3]
                    path_b = group["items"][3:6]
                    group["items"] = [
                        {
                            "type": "one_of",
                            "items": [
                                { "type": "all_of", "items": path_a },
                                { "type": "all_of", "items": path_b }
                            ]
                        }
                    ]

with open(file_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print("JSON fixing applied successfully.")
