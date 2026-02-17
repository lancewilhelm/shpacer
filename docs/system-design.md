# Shpacer System Design Document

## Overview

Shpacer is a self-hosted web application designed for race course planning and analysis. It provides tools for uploading GPS track files, visualizing course data, managing waypoints, and analyzing race metrics. The system is built using modern web technologies with a focus on user experience, data accuracy, and extensibility.

## System Architecture

### Technology Stack

- **Frontend Framework**: Nuxt 4 with Vue 3 and TypeScript
- **UI Framework**: Tailwind CSS v4 with CSS custom properties for theming
- **Database**: SQLite with Drizzle ORM for type-safe database operations
- **Authentication**: Better Auth with role-based access control
- **Mapping**: Leaflet for interactive map visualization
- **File Processing**: Custom GPX/TCX parsers with GeoJSON conversion
- **State Management**: Pinia for centralized state management
- **Real-time Sync**: Custom debounced synchronization system

### Architecture Principles

1. **Self-Hosted First**: Designed to run on user-controlled infrastructure
2. **Progressive Enhancement**: Works with JavaScript disabled for core functionality
3. **Mobile-Responsive**: Optimized for both desktop and mobile experiences
4. **Type Safety**: Comprehensive TypeScript coverage throughout the application
5. **Performance**: Efficient data structures and lazy loading where appropriate

## User Interaction Flow

### 1. Authentication Flow

```
User Access → Login/Register → Session Creation → Role Assignment → Dashboard
```

- **Anonymous Users**: Redirected to login page
- **Authenticated Users**: Access based on role permissions
- **First User**: Automatically assigned "owner" role
- **Registration Control**: Can be disabled by administrators

### 2. Course Creation Workflow

```
File Upload → Validation → Processing → Preview Rendering → Metrics Calculation → Waypoint Extraction → Storage
```

1. **File Upload**: Users drag and drop or select GPX/TCX files
2. **Validation**: File format and content validation
3. **Processing**: Parse GPS data and convert to GeoJSON format
4. **Preview Rendering**: Show map preview, distance stats, and elevation gain/loss stats (when elevation samples exist), plus an elevation profile
5. **Metrics Calculation**: Compute distance, elevation gain/loss, and route statistics
6. **Waypoint Extraction**: Automatically extract waypoints from file metadata
7. **Storage**: Save course data, original file content, and computed metrics

Notes:
- Elevation preview is file-backed only (no server-side elevation derivation for missing samples).
- Persisted course metrics remain server-authoritative and are recalculated during course creation.
- Implementation details: `app/pages/courses/new.vue`, `app/components/ElevationProfilePreview.vue`, and `app/utils/elevationProfile.ts`.

### 3. Course Interaction Workflow

```
Course Selection → Map Display → Interactive Exploration → Waypoint Management → Export/Share
```

1. **Course Selection**: Browse and select from user's course library
2. **Map Display**: Interactive map with route visualization and controls
3. **Interactive Exploration**: 
   - Hover over route for distance/elevation data
   - For overlapping out-and-back sections, map hover uses a precomputed overlap index to resolve up to two route distances and renders dual chart cursors (primary + secondary); single-track sections stay single-cursor
   - Click to create waypoints
   - On overlapping sections, click interactions prompt for which route distance to use (for waypoint creation and move actions)
   - Waypoint creation and waypoint repositioning reject duplicate route positions (same course distance as an existing waypoint)
   - Exiting manual waypoint creation resets the map to the same full-course fit used on initial waypoint-tab render
   - Drag waypoints to reposition
4. **Waypoint Management**: Edit names, tags, and properties
5. **Export/Share**: Download original files or share course data

Implementation details: `app/components/CourseEditModal.vue` and `app/components/LeafletMap.vue`.

Form validation/action errors in course, waypoint, and plan modals are shown as dismissible alerts.

### 4. Settings and Customization Flow

```
Settings Access → Category Selection → Preference Updates → Real-time Sync → Visual Updates
```

1. **Settings Access**: Navigate to settings through user menu
2. **Category Selection**: Choose from General, Appearance, Cloud, or Admin settings
3. Preference Updates: Modify themes, unit strategy (follow course or override) and units, fonts, and system preferences
4. **Real-time Sync**: Changes synchronized across user sessions
5. **Visual Updates**: UI immediately reflects new preferences

## System Requirements

### Functional Requirements

#### Core Features
- **FR001**: System shall support uploading and processing GPX and TCX files
- **FR002**: System shall calculate accurate course metrics (distance, elevation)
- **FR003**: System shall provide interactive map visualization with waypoint management
- **FR004**: System shall support multiple user accounts with role-based permissions
- **FR005**: System shall maintain course data persistence and user preferences
- **FR006**: System shall provide customizable themes, unit preferences, and display options (supports course default units with user override)

#### Waypoint Management
- **FR007**: System shall automatically extract waypoints from GPS files
- **FR008**: System shall allow manual waypoint creation via map interaction
- **FR009**: System shall support waypoint editing with route snapping
- **FR010**: System shall provide waypoint tagging and categorization
- **FR011**: System shall maintain waypoint order and distance calculations

#### User Experience
- **FR012**: System shall provide responsive design for mobile and desktop
- **FR013**: System shall support keyboard navigation and accessibility
- **FR014**: System shall provide real-time feedback for user actions
- **FR015**: System shall maintain user session state across browser refreshes

### Non-Functional Requirements

#### Performance
- **NFR001**: Course upload and processing shall complete within 30 seconds for files up to 50MB
- **NFR002**: Map rendering shall support smooth interaction with routes up to 1000 waypoints
- **NFR003**: Database operations shall respond within 500ms for typical queries
- **NFR004**: Initial page load shall complete within 3 seconds on typical connections

#### Security
- **NFR005**: All user data shall be encrypted in transit using HTTPS
- **NFR006**: User passwords shall be hashed using industry-standard algorithms
- **NFR007**: Session management shall prevent unauthorized access
- **NFR008**: File uploads shall be validated and sanitized

#### Reliability
- **NFR009**: System shall maintain 99.5% uptime during normal operation
- **NFR010**: Data shall be automatically backed up and recoverable
- **NFR011**: System shall gracefully handle network interruptions
- **NFR012**: Database migrations shall be reversible and tested

#### Scalability
- **NFR013**: System shall support up to 1000 concurrent users
- **NFR014**: Database shall efficiently handle 100,000+ courses
- **NFR015**: File storage shall scale to accommodate user growth
- **NFR016**: System shall be deployable on various hosting platforms

#### Usability
- **NFR017**: Interface shall be intuitive for users with basic computer skills
- **NFR018**: System shall provide clear error messages and recovery options
- **NFR019**: Help documentation shall be accessible within the application
- **NFR020**: System shall support multiple languages (extensible)

### Technical Requirements

#### Browser Compatibility
- **TR001**: Support for modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- **TR002**: Progressive enhancement for older browsers
- **TR003**: Mobile browser optimization (iOS Safari, Chrome Mobile)

#### Server Requirements
- **TR004**: Node.js 18+ runtime environment
- **TR005**: Minimum 2GB RAM for optimal performance
- **TR006**: SSD storage recommended for database performance
- **TR007**: Network connectivity for map tile loading

#### Development Requirements
- **TR008**: TypeScript for type safety and development efficiency
- **TR009**: Automated testing suite with comprehensive coverage
- **TR010**: Continuous integration and deployment pipeline
- **TR011**: Code quality enforcement with ESLint and Prettier

## Data Architecture

### Database Schema

#### Core Entities
1. **Users**: Authentication and profile information
2. **Courses**: GPS track data, metadata, and default unit preferences (distance/elevation)
3. **Waypoints**: Point-of-interest data along routes
4. **User Settings**: Personalization preferences, including unit strategy (follow course vs override) and global unit defaults
5. **Global Settings**: System-wide configuration

#### Relationships
- Users have many Courses (one-to-many)
- Courses have many Waypoints (one-to-many)
- Users have one User Settings record (one-to-one)
- System has one Global Settings record (singleton)

### File Storage Strategy

- **Original Files**: Stored as base64 encoded strings in database
- **Processed Data**: GeoJSON format for efficient map rendering
- **Metadata**: Extracted and stored separately for quick access
- **Backup Strategy**: Database-level backups include all file content

## Security Considerations

### Authentication & Authorization
- Session-based authentication with secure cookies
- Role-based access control (Owner, Admin, User)
- Password complexity requirements and secure hashing
- Registration controls for closed systems

### Data Protection
- Input validation and sanitization for all user data
- SQL injection prevention through ORM parameterization
- XSS protection through Vue's built-in escaping
- CSRF protection through same-site cookie policies

### File Upload Security
- File type validation (GPX/TCX only)
- Content validation to prevent malicious uploads
- Size limits to prevent resource exhaustion
- Virus scanning integration (recommended for production)

## Performance Optimization

### Frontend Optimization
- Code splitting and lazy loading for large components
- Image optimization and lazy loading
- Efficient state management with minimal re-renders
- Service worker caching for offline functionality

### Backend Optimization
- Database indexing for frequent queries
- Connection pooling for database efficiency
- Caching strategies for computed metrics
- Async processing for file uploads

### Map Performance
- Tile caching and progressive loading
- Waypoint clustering for dense routes
- Level-of-detail rendering for complex routes
- Efficient coordinate processing algorithms

## Deployment Architecture

### Self-Hosted Deployment
- Docker containerization for easy deployment
- Environment-based configuration
- Database migration automation
- Health check endpoints for monitoring

### Recommended Infrastructure
- Reverse proxy (nginx) for SSL termination
- Process management (PM2 or systemd)
- Regular database backups
- Log aggregation and monitoring

### Scaling Considerations
- Horizontal scaling through load balancing
- Database read replicas for high-traffic scenarios
- CDN integration for static assets
- Microservice extraction for specialized functions

## Error Handling and Recovery

### User-Facing Errors
- Clear, actionable error messages
- Graceful degradation for network issues
- Retry mechanisms for transient failures
- Offline mode for core functionality

### System-Level Errors
- Comprehensive logging and monitoring
- Automatic error reporting
- Database transaction rollback
- Service restart automation

## Future Extensibility

### Plugin Architecture
- Modular waypoint types and behaviors
- Custom map layer support
- Third-party authentication providers
- API endpoints for external integrations

### Feature Roadmap
- Real-time collaboration on courses
- Advanced analytics and reporting
- Mobile application development
- Integration with fitness tracking platforms

### API Design
- RESTful API design principles
- Comprehensive API documentation
- Rate limiting and authentication
- Webhook support for external systems

## Monitoring and Maintenance

### Application Monitoring
- Performance metrics and alerting
- User behavior analytics
- Error tracking and reporting
- Database performance monitoring

### Maintenance Procedures
- Regular database optimization
- Security update deployment
- Feature flag management
- User data cleanup and archival

This system design provides a comprehensive foundation for understanding Shpacer's architecture, requirements, and implementation strategy while maintaining flexibility for future enhancements and scaling needs.
