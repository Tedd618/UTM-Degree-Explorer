import json
import os

fall_winter_path = os.path.join("data", "seasonal", "fall_winter_courses.json")
summer_path = os.path.join("data", "seasonal", "summer_courses.json")
main_courses_path = os.path.join("data", "courses.json")
app_public_courses_path = os.path.join("app", "public", "data", "courses.json")

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

print("Loading seasonal data...")
fw_courses = load_json(fall_winter_path)
summer_courses = load_json(summer_path)

# Map from course code to set of seasons it is offered in
offerings_map = {}

# Process Fall/Winter
for c in fw_courses:
    code = c.get("code")
    if not code:
        continue
    if code not in offerings_map:
        offerings_map[code] = set()
        
    section = c.get("sectionCode") # "F", "S", "Y"
    if section == "F":
        offerings_map[code].add("Fall")
    elif section == "S":
        offerings_map[code].add("Winter")
    elif section == "Y":
        offerings_map[code].add("Fall")
        offerings_map[code].add("Winter")

# Process Summer
for c in summer_courses:
    code = c.get("code")
    if not code:
        continue
    if code not in offerings_map:
        offerings_map[code] = set()
    offerings_map[code].add("Summer")

print(f"Computed offerings for {len(offerings_map)} distinct courses.")

print("Loading main courses dataset...")
main_courses = load_json(main_courses_path)

updates_made = 0
for course in main_courses:
    code = course.get("code")
    if code in offerings_map:
        course["offerings"] = list(offerings_map[code])
        updates_made += 1
    else:
        # Fallback: if not in the new scraped data, assume it might be full or unknown?
        # Actually, let's leave it without 'offerings' or empty list. The frontend can
        # treat missing array as "unknown" or "always valid", but let's just assign empty
        course["offerings"] = []

print(f"Updated {updates_made} courses in main dataset.")

with open(main_courses_path, 'w', encoding='utf-8') as f:
    json.dump(main_courses, f, indent=2, ensure_ascii=False)

# Optional: Also write to app/public if it exists and needs it identically
if os.path.exists(os.path.dirname(app_public_courses_path)):
    with open(app_public_courses_path, 'w', encoding='utf-8') as f:
        json.dump(main_courses, f, indent=2, ensure_ascii=False)
    print(f"Also updated {app_public_courses_path}")
else:
    print(f"Warning: {app_public_courses_path} not found")

print("Done.")
