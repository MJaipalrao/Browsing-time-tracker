# Privacy

Browsing Time Tracker stores browsing analytics locally in Chrome using `chrome.storage.local`.

## Data Stored

- Visited HTTP/HTTPS domains
- Page URLs and tab titles for timeline entries
- Time spent per domain and category
- Extension settings such as idle threshold, ignored domains, and retention days

## Data Sharing

The extension does not send browsing data to any server. There are no analytics SDKs, remote APIs, ads, or third-party trackers.

## User Controls

- Disable tracking from the dashboard settings page
- Add ignored domains that should not be tracked
- Change local data retention
- Export data as JSON or CSV
- Clear all stored data

## Permissions

- `tabs`: read active tab URL/title for tracking
- `storage`: save local analytics and settings
- `alarms`: periodically record elapsed active time
- `idle`: pause tracking when the browser/user is idle
- `favicon`: display website icons from Chrome's built-in favicon cache
