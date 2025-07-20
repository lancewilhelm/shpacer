# Shpacer

![Nuxt](https://img.shields.io/badge/Nuxt%204-%23000000?style=for-the-badge&logo=nuxt)
![Vue](https://img.shields.io/badge/Vue%203-%23191A22?style=for-the-badge&logo=vuedotjs)
![Tailwind](https://img.shields.io/badge/Tailwind%20v4-%231a202c?style=for-the-badge&logo=tailwind-css)
![SQLite](https://img.shields.io/badge/SQLite-%231a202c?style=for-the-badge&logo=sqlite)
![Drizzle](https://img.shields.io/badge/Drizzle%20ORM-%231a202c?style=for-the-badge&logo=drizzle)

A self-hosted web application for race course planning and analysis.

## Features

### Course Management

- Upload and process GPX and TCX files to create race courses
- Calculate comprehensive course metrics including total distance, elevation gain, and elevation loss
- Store original file content and metadata for future reference
- Set race dates and times for event planning

### Interactive Visualization

- Interactive map display using Leaflet with course route visualization
- Elevation profile charts showing terrain changes along the course
- Hover over the route to see distance and elevation at any point
- Visual waypoint markers with customizable colors and icons

### Waypoint System

- Extract waypoints automatically from GPX/TCX files
- Create custom waypoints manually by clicking on the map or elevation chart
- Edit waypoint positions by dragging on the map with automatic route snapping
- Organize waypoints with tags and custom naming
- Display start, intermediate, and finish waypoints with distinct visual styling

### User Management

- Secure authentication with email and password
- Role-based access control (owner, admin, user)
- User registration controls (can be disabled by administrators)
- Account management including password changes

### Customization

- Multiple visual themes with light and dark options
- Customizable font families
- Favorite themes system
- Metric and imperial unit support for distance and elevation
- Responsive design for desktop and mobile devices

### Data Management

- SQLite database with automatic migrations
- Cloud synchronization for user settings
- Course data export and download capabilities
- Comprehensive error handling and validation

## Technology Stack

- **Frontend**: Nuxt 4, Vue 3, TypeScript
- **Styling**: Tailwind CSS v4 with CSS custom properties
- **Database**: SQLite with Drizzle ORM
- **Authentication**: Better Auth with role-based permissions
- **Maps**: Leaflet for interactive mapping
- **Charts**: Custom elevation profile visualization
- **File Processing**: GPX and TCX parser with GeoJSON conversion
