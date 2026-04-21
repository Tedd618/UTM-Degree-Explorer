import requests
import json
import time

URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://ttb.utoronto.ca",
    "Referer": "https://ttb.utoronto.ca/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
}

def get_base_payload():
    return {
        "courseCodeAndTitleProps": {
            "courseCode": "",
            "courseTitle": "",
            "courseSectionCode": ""
        },
        "departmentProps": [],
        "campuses": [],
        "requirementProps": [],
        "instructor": "",
        "courseLevels": [],
        "deliveryModes": [],
        "dayPreferences": [],
        "timePreferences": [],
        "divisions": ["ERIN"],
        "creditWeights": [],
        "availableSpace": False,
        "waitListable": False,
        "pageSize": 20,
        "direction": "asc"
    }

def fetch_pages(sessions, num_pages, output_file):
    all_courses = []
    print(f"Fetching {num_pages} pages for sessions: {sessions}")
    for page in range(1, num_pages + 1):
        payload = get_base_payload()
        payload["sessions"] = sessions
        payload["page"] = page
        
        retries = 3
        while retries > 0:
            try:
                response = requests.post(URL, headers=HEADERS, json=payload, timeout=15)
                if response.status_code == 200:
                    data = response.json()
                    page_courses = data.get("payload", {}).get("pageableCourse", {}).get("courses", [])
                    print(f"Page {page}/{num_pages} - Fetched {len(page_courses)} courses")
                    all_courses.extend(page_courses)
                    break
            except Exception:
                pass
            retries -= 1
            time.sleep(2)
            
        time.sleep(0.5)

    print(f"Successfully fetched a total of {len(all_courses)} courses.")
    with open(output_file, 'w', encoding='utf-8') as f:
         json.dump(all_courses, f, ensure_ascii=False, indent=2)
    print(f"Saved to {output_file}\n")


if __name__ == "__main__":
    summer_sessions = ["20265", "20265F", "20265S"]
    fetch_pages(summer_sessions, 17, "summer_courses_full.json")
