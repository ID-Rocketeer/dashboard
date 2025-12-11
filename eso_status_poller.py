import requests
import json
# from datetime import datetime  # TODO: Remove if not used

# --- Configuration ---
# The known API endpoint for ESO server realms status
ESO_API_URL = "https://live-services.elderscrollsonline.com/status/realms"

# Spoof a common browser User-Agent for polite requesting
CHROME_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)

# A list of the specific, exact keys we want from the API response's
# 'response' object
TARGET_SERVERS = [
    "The Elder Scrolls Online (NA)",
    "The Elder Scrolls Online (EU)"
]
# ---------------------


def fetch_eso_status():
    """
    Fetches the ESO server status from the official API endpoint,
    navigates the nested JSON, and returns the status for PC NA and PC EU.
    """
    try:
        # 1. Prepare Headers with Spoofed User-Agent
        headers = {
            'User-Agent': CHROME_USER_AGENT,
            'Accept': 'application/json',
        }

        # 2. Make the HTTP GET Request
        response = requests.get(ESO_API_URL, headers=headers, timeout=10)

        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status()

        # 3. Parse the JSON Response
        data = response.json()

        # 4. Navigate the Nested Structure
        server_status = {}

        # Navigate to the 'response' dictionary which holds the
        # status strings.
        # This handles the specific structure:
        # data['zos_platform_response']['response']
        try:
            realms = data['zos_platform_response']['response']
        except KeyError:
            # Handle cases where the structure has changed or is unexpected
            return {
                "STATUS": "STRUCTURE ERROR",
                "MESSAGE": "API keys zos_platform_response or response "
                           "not found."
            }

        # 5. Extract and Format Relevant Data
        for server_key in TARGET_SERVERS:

            if server_key in realms:
                # The status is the VALUE (a string, e.g., "UP")
                # associated with the key
                status = realms[server_key].upper()

                # Format the key for cleaner dashboard display (e.g., "NA"
                # or "EU")
                # Strips the "The Elder Scrolls Online ()" part
                display_key = server_key.replace(
                    "The Elder Scrolls Online", "").strip()
                display_key = display_key.replace(
                    "(", "").replace(")", "").strip()

                server_status[display_key.upper()] = status
            else:
                server_status[server_key.upper()] = "SERVER KEY NOT FOUND"

        return server_status

    except requests.exceptions.HTTPError as e:
        # Handles 404, 500 errors, etc.
        return {
            "STATUS": "HTTP ERROR",
            "MESSAGE": f"Failed to connect (HTTP {e.response.status_code})"
        }
    except requests.exceptions.RequestException:
        # Handles network issues, timeouts, etc.
        return {"STATUS": "NETWORK ERROR", "MESSAGE": "Connection Issue"}
    except json.JSONDecodeError:
        # Handles cases where the response is not valid JSON
        return {"STATUS": "JSON ERROR", "MESSAGE": "Invalid JSON response"}


# --- Example Usage (Optional: for individual testing) ---
if __name__ == "__main__":
    status_data = fetch_eso_status()
    print(json.dumps(status_data, indent=4))
