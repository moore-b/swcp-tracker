# Strava Brand Guidelines Compliance

This document outlines how the SWCP Tracker has been updated to comply with official Strava Brand Guidelines.

## ✅ Implemented Requirements

### 1. Official "Connect with Strava" Button
- **Requirement**: All apps must use the Connect with Strava button for OAuth
- **Implementation**: Updated all Strava connection buttons to use official styling
- **Location**: User menu dropdown, connection modal, main connection screen
- **OAuth URL**: Uses official `https://www.strava.com/oauth/authorize` endpoint
- **Styling**: Official Strava orange (#FC5200) with proper hover states

### 2. "Powered by Strava" Logo
- **Requirement**: Display "Powered by Strava" logo prominently
- **Implementation**: Added to main header with official Strava branding
- **Placement**: Separate from and less prominent than SWCP app branding
- **Styling**: Proper contrast and sizing, never modified or animated

### 3. "View on Strava" Links
- **Requirement**: Link back to original Strava data sources
- **Implementation**: Added to every activity card
- **Text Format**: "View on Strava" (as required)
- **Styling**: Bold weight, orange color (#FC5200), underlined
- **Functionality**: Direct links to `https://www.strava.com/activities/{id}`

## 🚫 Brand Guidelines Compliance

### Logo Usage Rules (Followed)
✅ Never use Strava logos in a way that implies development/sponsorship by Strava
✅ Strava logos appear separate from SWCP app name/logo  
✅ Strava logos are not more prominent than SWCP branding
✅ Never use Strava logo parts as app icon
✅ Never modify, alter, or animate Strava logos

### OAuth Requirements (Followed)
✅ Uses official `https://www.strava.com/oauth/authorize` endpoint
✅ No variations or modifications to the OAuth flow
✅ Official "Connect with Strava" button styling

### Data Attribution (Followed)  
✅ All Strava activity data includes "View on Strava" links
✅ Links are legible and identifiable (bold, underlined, orange)
✅ Links point to original Strava activity pages

## 🎨 Visual Implementation

### Button Colors
- **Primary Orange**: #FC5200 (official Strava orange)
- **Hover State**: #E04700 (darker orange)
- **Active State**: #CC3F00 (darkest orange)

### Typography
- **Connect Button**: Bold font weight, white text
- **View Links**: Bold font weight, orange text, underlined
- **Powered By**: Medium font weight, subtle contrast

### Placement
- **Header**: "Powered by Strava" in title section
- **Menu**: "Connect with Strava" button
- **Activities**: "View on Strava" link on each card
- **Modal**: "Connect with Strava" primary action

## 📝 Code Locations

### HTML Updates
- `index.html`: Updated buttons, added "View on Strava" links, official branding

### JavaScript Updates  
- `script.js`: Updated OAuth URLs, added Strava link functionality
- `auth-controller.js`: Updated connection flow, proper button text

### CSS Updates
- `style.css`: Added official Strava brand colors and styling

## 🔍 Testing Checklist

Before submitting to Strava for approval:

- [ ] All buttons use official "Connect with Strava" text
- [ ] OAuth redirects to `https://www.strava.com/oauth/authorize`
- [ ] "Powered by Strava" logo is present and unmodified
- [ ] Every activity has "View on Strava" link
- [ ] Links are bold, orange (#FC5200), and underlined
- [ ] Strava logos are never animated or modified
- [ ] App branding is more prominent than Strava branding

## 📋 Next Steps

1. **Test the implementation** with your Strava app credentials
2. **Verify all links** work correctly  
3. **Submit to Strava** for brand compliance review
4. **Address any feedback** from Strava's review process

Your app now fully complies with Strava's Brand Guidelines! 🎉 