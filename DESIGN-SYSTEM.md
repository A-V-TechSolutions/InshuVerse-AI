# InshuVerse AI - Advanced Design System Documentation

## Overview

The InshuVerse AI Advanced Design System is a production-ready design framework that provides modern UI components, advanced animations, and comprehensive styling utilities. This system is built to enhance the user experience while maintaining performance and accessibility.

## File Structure

```
src/styles/
├── advanced-design-system.css    # Core design system with animations & tokens
├── component-library.css          # Additional UI components
├── design-system.css              # Base design system (Slate & Signal theme)
├── gate-purple-theme.css          # Sign-in screen purple theme
├── light-theme.css                # Light theme override
├── loading-states.css             # Loading state animations
└── error-handler.css              # Error handling styles
```

## Loading Order (Critical)

The stylesheets must be loaded in this specific order in `index.html`:

1. `loading-states.css` - Base loading animations
2. `error-handler.css` - Error handling styles
3. `design-system.css` - Core design system (Slate & Signal)
4. `advanced-design-system.css` - Advanced animations & components
5. `component-library.css` - Additional UI components
6. `gate-purple-theme.css` - Sign-in screen theme (loaded last)

## Design Tokens

### Animation Timings
```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
--ease-in-out-quart: cubic-bezier(0.76, 0, 0.24, 1);
--ease-elastic: cubic-bezier(0.68, -0.55, 0.265, 1.55);
```

### Glassmorphism
```css
--glass-bg-strong: rgba(255, 255, 255, 0.12);
--glass-bg-medium: rgba(255, 255, 255, 0.08);
--glass-bg-weak: rgba(255, 255, 255, 0.04);
--glass-border: rgba(255, 255, 255, 0.18);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
--glass-blur: blur(20px) saturate(180%);
```

### Gradients
```css
--gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
--gradient-success: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
--gradient-warning: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
--gradient-info: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
```

### Shadows
```css
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.12);
--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.16);
--shadow-xl: 0 16px 64px rgba(0, 0, 0, 0.2);
--shadow-glow: 0 0 40px rgba(102, 126, 234, 0.4);
```

## Available Animations

### Entry Animations
- `fadeInUp` - Fade in with upward movement
- `fadeInDown` - Fade in with downward movement
- `fadeInScale` - Fade in with scale effect
- `slideInRight` - Slide in from right
- `slideInLeft` - Slide in from left
- `bounceIn` - Bounce in effect

### Continuous Animations
- `pulseGlow` - Pulsing glow effect
- `shimmer` - Shimmer/sweep effect
- `rotate` - Continuous rotation
- `float` - Floating effect
- `gradientMove` - Moving gradient
- `morphBlob` - Morphing blob shape

### Interactive Animations
- `ripple` - Ripple effect on click
- `typing` - Typing indicator dots
- `progress` - Progress bar animation

### Usage Example
```html
<div class="animate-fade-in-up">Content</div>
<div class="animate-pulse-glow">Glowing element</div>
<div class="animate-float">Floating element</div>
```

## Core Components

### Glass Card
```html
<div class="glass-card">
    <h3>Card Title</h3>
    <p>Card content goes here</p>
</div>
```

### Gradient Card
```html
<div class="gradient-card">
    <h3>Featured Card</h3>
    <p>Content with gradient background</p>
</div>
```

### Badges
```html
<span class="badge badge-primary">Primary</span>
<span class="badge badge-success">Success</span>
<span class="badge badge-warning">Warning</span>
<span class="badge badge-info">Info</span>
<span class="badge badge-glass">Glass</span>
```

### Progress Ring
```html
<div class="progress-ring">
    <svg width="60" height="60">
        <circle class="progress-ring-bg" cx="30" cy="30" r="26"/>
        <circle class="progress-ring-progress" cx="30" cy="30" r="26" 
                stroke-dasharray="163.36" stroke-dashoffset="40"/>
    </svg>
    <span class="progress-ring-text">75%</span>
</div>
```

### Progress Bar
```html
<div class="progress-bar">
    <div class="progress-bar-fill" style="width: 60%"></div>
</div>
```

### Tooltip
```html
<div class="tooltip" data-tooltip="Tooltip text">
    Hover me
</div>
```

### Avatar
```html
<img src="avatar.jpg" class="avatar" alt="User">
<img src="avatar.jpg" class="avatar avatar-lg" alt="User">
<img src="avatar.jpg" class="avatar avatar-sm" alt="User">
```

### Skeleton Loader
```html
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text-lg"></div>
<div class="skeleton skeleton-avatar"></div>
```

### Toast Notification
```html
<div class="toast success">
    <i class="material-icons">check_circle</i>
    <span>Success message</span>
</div>
```

### Floating Action Button
```html
<button class="fab">
    <i class="material-icons">add</i>
</button>
```

### Switch Toggle
```html
<div class="switch"></div>
<div class="switch active"></div>
```

### Input Field
```html
<input type="text" class="input-field" placeholder="Enter text">
```

### Dropdown
```html
<div class="dropdown">
    <button>Toggle Dropdown</button>
    <div class="dropdown-menu">
        <div class="dropdown-item">Option 1</div>
        <div class="dropdown-item">Option 2</div>
    </div>
</div>
```

## Component Library Components

### Stats Card
```html
<div class="stats-card">
    <div class="stats-card-value">1,234</div>
    <div class="stats-card-label">Total Users</div>
</div>
```

### Feature Card
```html
<div class="feature-card">
    <div class="feature-card-icon">
        <i class="material-icons">star</i>
    </div>
    <h3>Feature Title</h3>
    <p>Feature description</p>
</div>
```

### Buttons
```html
<button class="btn-gradient">Gradient Button</button>
<button class="btn-outline">Outline Button</button>
<button class="btn-ghost">Ghost Button</button>
<button class="btn-icon"><i class="material-icons">add</i></button>
```

### Search Input
```html
<div class="search-input">
    <i class="material-icons">search</i>
    <input type="text" placeholder="Search...">
</div>
```

### File Upload
```html
<div class="file-upload">
    <i class="material-icons">cloud_upload</i>
    <p>Drag & drop files here</p>
</div>
```

### Breadcrumb
```html
<div class="breadcrumb">
    <span class="breadcrumb-item">Home</span>
    <span class="breadcrumb-separator">/</span>
    <span class="breadcrumb-item">Category</span>
    <span class="breadcrumb-separator">/</span>
    <span class="breadcrumb-item active">Page</span>
</div>
```

### Tabs
```html
<div class="tabs">
    <div class="tab active">Tab 1</div>
    <div class="tab">Tab 2</div>
    <div class="tab">Tab 3</div>
</div>
```

### Pagination
```html
<div class="pagination">
    <div class="pagination-item">1</div>
    <div class="pagination-item active">2</div>
    <div class="pagination-item">3</div>
</div>
```

### Alerts
```html
<div class="alert alert-info">
    <i class="material-icons">info</i>
    <span>Info message</span>
</div>
<div class="alert alert-success">
    <i class="material-icons">check_circle</i>
    <span>Success message</span>
</div>
<div class="alert alert-warning">
    <i class="material-icons">warning</i>
    <span>Warning message</span>
</div>
<div class="alert alert-error">
    <i class="material-icons">error</i>
    <span>Error message</span>
</div>
```

### Chips/Tags
```html
<div class="chip">
    <span>Tag</span>
    <i class="material-icons chip-close">close</i>
</div>
```

### Rating Stars
```html
<div class="rating">
    <i class="material-icons rating-star filled">star</i>
    <i class="material-icons rating-star filled">star</i>
    <i class="material-icons rating-star filled">star</i>
    <i class="material-icons rating-star">star</i>
    <i class="material-icons rating-star">star</i>
</div>
```

### Grid System
```html
<div class="grid grid-3">
    <div>Item 1</div>
    <div>Item 2</div>
    <div>Item 3</div>
</div>
```

### Data Table
```html
<table class="data-table">
    <thead>
        <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>John Doe</td>
            <td>john@example.com</td>
            <td>Active</td>
        </tr>
    </tbody>
</table>
```

### Timeline
```html
<div class="timeline">
    <div class="timeline-item">
        <div class="timeline-date">2024-01-01</div>
        <div class="timeline-content">Event description</div>
    </div>
</div>
```

### Accordion
```html
<div class="accordion-item">
    <div class="accordion-header">
        <span>Section Title</span>
        <i class="material-icons accordion-icon">expand_more</i>
    </div>
    <div class="accordion-content">
        <p>Content goes here</p>
    </div>
</div>
```

## Utility Classes

### Animation Utilities
```css
.animate-fade-in-up
.animate-fade-in-down
.animate-fade-in-scale
.animate-slide-in-right
.animate-slide-in-left
.animate-bounce-in
.animate-pulse-glow
.animate-float
```

### Visual Utilities
```css
.glass              /* Glassmorphism effect */
.gradient           /* Gradient background */
.shadow-sm          /* Small shadow */
.shadow-md          /* Medium shadow */
.shadow-lg          /* Large shadow */
.shadow-xl          /* Extra large shadow
```

### Border Radius Utilities
```css
.rounded-sm         /* 8px radius */
.rounded-md         /* 12px radius */
.rounded-lg         /* 16px radius */
.rounded-xl         /* 24px radius */
.rounded-full       /* Full radius */
```

### Effect Utilities
```css
.hover-lift         /* Lift on hover */
.hover-glow         /* Glow on hover */
.hover-scale        /* Scale on hover */
.gradient-border    /* Gradient border on hover */
.glass-morphism     /* Glass morphism effect */
```

### Layout Utilities
```css
.flex               /* Flex container */
.flex-center        /* Centered flex */
.flex-between       /* Space between flex */
.flex-column        /* Column flex */
.flex-wrap          /* Wrapping flex */
```

### Container Utilities
```css
.container-fluid    /* Full width container */
.container-narrow   /* Narrow container (800px) */
.container-wide     /* Wide container (1400px) */
```

## Responsive Design

### Mobile-First Breakpoints
```css
@media (max-width: 480px)  /* Extra small devices */
@media (max-width: 768px)  /* Small devices (tablets) */
@media (min-width: 769px)  /* Desktop and up */
```

### Responsive Utilities
```css
.hide-mobile        /* Hide on mobile */
.show-mobile        /* Show only on mobile */
.hide-desktop       /* Hide on desktop */
.show-desktop       /* Show only on desktop */
```

## Accessibility

### Reduced Motion Support
All animations respect `prefers-reduced-motion` and are automatically disabled for users who prefer reduced motion.

### Focus States
All interactive elements have visible focus states for keyboard navigation.

### Screen Reader Support
- `.sr-only` class for screen-reader-only content
- Proper ARIA labels should be added to interactive elements
- Semantic HTML structure is maintained

### High Contrast Mode
Components adapt to high contrast mode preferences with increased border visibility.

## Performance Optimizations

### GPU Acceleration
```css
.gpu-accelerated    /* Enables GPU acceleration */
```

### Layout Containment
```css
.contain-layout     /* Layout containment */
.contain-paint      /* Paint containment */
```

### Content Visibility
```css
.content-visibility-auto  /* Automatic content visibility */
```

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (with -webkit- prefixes)
- Opera: Full support

## Customization

### Overriding Tokens
You can override design tokens in your custom CSS:

```css
:root {
    --gradient-primary: linear-gradient(135deg, #your-color-1 0%, #your-color-2 100%);
    --glass-bg-strong: rgba(255, 255, 255, 0.15);
}
```

### Adding Custom Animations
Add custom keyframe animations to the advanced-design-system.css file:

```css
@keyframes yourAnimation {
    from { /* start state */ }
    to { /* end state */ }
}
```

## Best Practices

1. **Use utility classes for common patterns** - Combine utility classes for rapid development
2. **Prefer component classes for complex elements** - Use semantic component classes for better maintainability
3. **Test animations with reduced motion** - Ensure your app works without animations
4. **Use semantic HTML** - Maintain proper document structure
5. **Optimize images and assets** - Keep performance in mind
6. **Test across browsers** - Ensure cross-browser compatibility
7. **Use appropriate contrast ratios** - Maintain accessibility standards
8. **Document custom components** - Keep your team informed about new components

## Migration Guide

### From Old Design System
1. Remove old stylesheet references
2. Add new stylesheet references in correct order
3. Replace old component classes with new ones
4. Test all pages and components
5. Update any custom CSS that conflicts

### Adding to Existing Components
1. Add new utility classes to existing elements
2. Replace old animations with new ones
3. Update color tokens to use new system
4. Test responsive behavior

## Troubleshooting

### Styles Not Applying
- Check stylesheet loading order
- Verify file paths are correct
- Check for CSS specificity conflicts
- Clear browser cache

### Animations Not Working
- Verify animation class names are correct
- Check for JavaScript conflicts
- Test with reduced motion disabled
- Check browser console for errors

### Responsive Issues
- Verify viewport meta tag is present
- Check media query syntax
- Test on actual devices
- Verify container widths

## Support

For issues or questions about the design system:
1. Check this documentation first
2. Review the CSS files for implementation details
3. Test in isolation to identify conflicts
4. Consult with the design team

## Changelog

### Version 3.0 (Current)
- Added advanced design system with modern animations
- Added comprehensive component library
- Added glassmorphism effects
- Added advanced keyframe animations
- Added responsive utilities
- Added accessibility improvements
- Added performance optimizations

### Version 2.0
- Slate & Signal theme implementation
- Design system tokens
- Base component styling

### Version 1.0
- Initial design system
- Basic component library
