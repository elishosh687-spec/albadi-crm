# 3D Bag Configurator - MVP Implementation

## Overview

A complete 3D product configurator for non-woven bags built with Next.js, Three.js, and React Three Fiber. Allows customers to design custom bags with color selection, logo upload, and real-time 3D preview, then download a professional pricing contract with embedded 3D mockup.

**Route:** `/configurator`

## UI Layout (2026-06-10 redesign)

Full-screen immersive configurator (inspired by jewelry-designer style showrooms):

- **Full-bleed 3D stage** — the canvas fills the viewport with a soft pastel backdrop and pedestal.
- **Bottom dock** — compact floating pills, jewelry-configurator style:
  - Tab pill: `בד וצבע` / `לוגו` / `הצעת מחיר`
  - Color tab: horizontal scrollable swatch strip (all fabric colors)
  - Logo tab: upload button → thumbnail + mini sliders (size / X / Y / rotation) + reset/remove
  - Quote tab: total summary + button opening the quote drawer
- **Right vertical toolbar** — reset view, auto-rotate, PNG snapshot, quote/PDF, fullscreen.
- **Quote drawer** — slides in from the left with customer form, pricing, and PDF download.

The logo is a real **drei `<Decal>`** projected onto the bag mesh (wraps the fabric surface, supports rotation), not a floating plane.

## Features Implemented ✅

### 1. **3D Bag Viewer**
- Real-time interactive 3D non-woven tote bag rendered with Three.js
- Procedurally generated bag geometry:
  - Main rectangular body with realistic proportions
  - Two curved handles using torus geometry
  - Placeholder logo area on front face
- Professional lighting setup:
  - Ambient light for base illumination
  - Directional light with shadows
  - Ground shadow for depth perception
- Interactive controls:
  - OrbitControls for rotation, zoom, pan
  - Smooth camera animation
  - Mobile-friendly interaction
- Live material color updates

### 2. **Color Palette (30+ Colors)**
- Complete predefined color collection:
  - Neutral shades (White, Black, Greys, Beige, Cream)
  - Blues (Navy, Royal, Sky, Turquoise)
  - Greens (Dark Green, Lime, Olive, Teal, Mint)
  - Warm tones (Yellow, Orange, Red, Burgundy, Pink, Coral)
  - Purple shades (Purple, Lavender)
  - Earth tones (Brown, Chocolate, Khaki)
  - Metallics (Gold, Silver, Maroon)
- Visual color grid with hover effects
- Selected color indicator
- Real-time bag material update

### 3. **Logo Upload & Management**
- File format support: PNG, JPG, JPEG, SVG
- Max file size: 5MB
- Drag-and-drop compatible
- Image validation and error handling
- Logo preview thumbnail
- Remove/replace functionality

### 4. **Logo Positioning & Scaling Controls**
- **Size slider:** Scale logo 0.3x to 2x
- **Position X:** Horizontal placement (-1 to +1)
- **Position Y:** Vertical placement (-1 to +1)
- **Rotation:** 0-360° rotation adjustment
- **Reset button:** Return to default values
- Live preview updates
- Disabled when no logo uploaded

### 5. **Customer Information Form**
- Full Name (required)
- Email (required)
- Phone (required)
- Company Name (optional)
- Notes/Special requests (optional)
- Form validation with clear messaging

### 6. **Pricing Calculation**
- Dynamic tiered pricing:
  - 1-99 units: $2.50/unit
  - 100-499 units: $2.00/unit
  - 500-999 units: $1.70/unit
  - 1000+ units: $1.50/unit
- Setup fee: $50 (configurable)
- Real-time total calculation
- Pricing breakdown display
- Quantity input with instant updates

### 7. **PDF Contract Generation**
Professional PDF generation with:
- Header with title and date
- Customer details section
- Product information (color, quantity, logo status)
- Pricing breakdown and total
- Color swatch visualization
- 3D bag mockup screenshot
- Terms & conditions
- Professional footer

Generated filename format: `pricing-contract-{name}-{timestamp}.pdf`

### 8. **Responsive Design**
- Fully responsive layout
- Desktop: 3-column grid (3D viewer + 2 control columns)
- Tablet: 2-column layout
- Mobile: Stacked single column
- Touch-friendly controls
- Accessible form elements

## Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.2.5 | Framework & routing |
| React | 19.0.0 | UI framework |
| Three.js | Latest | 3D graphics |
| @react-three/fiber | Latest | React renderer for Three.js |
| @react-three/drei | Latest | Utility components (OrbitControls, etc.) |
| jsPDF | ^4.5.1 | PDF generation |
| TypeScript | Latest | Type safety |
| Tailwind CSS | Latest | Styling |

## File Structure

```
app/configurator/
├── page.tsx                           # Route page component

components/configurator/
├── ProductConfigurator.tsx            # Orchestrator: full-screen stage, bottom dock, toolbar, drawer
├── BagViewer3D.tsx                    # 3D scene: GLB bag, Decal logo, camera api (screenshot/reset)
├── configurator-state.ts              # Shared types + pricing helpers
├── PricingContractForm.tsx            # Customer info & pricing (rendered in quote drawer)
└── DownloadPdfButton.tsx              # PDF generation & download

lib/constants/
└── bagColors.ts                       # 30+ color definitions
```

## Component Architecture

### ProductConfigurator (Main)
Central state management orchestrator. Coordinates all subcomponents:
- Bag color selection state
- Logo upload and positioning state
- Customer information state
- Pricing calculations
- Screenshot callback for PDF

### BagViewer3D
Three.js/React Three Fiber implementation:
- Canvas setup with lighting
- Procedural bag geometry
- Logo texture mapping
- OrbitControls setup
- Screenshot capture

### ColorPalette
Visual color grid component:
- 30 color buttons
- Selected state styling
- Name display

### LogoUploader
File management:
- File input with validation
- Format/size checking
- Preview display
- Error messaging

### LogoControls
Interactive sliders:
- Scale, position X/Y, rotation
- Disabled state when no logo
- Real-time value updates
- Reset button

### PricingContractForm
Multi-section form:
- Customer details inputs
- Quantity with auto-tiering
- Pricing display
- Product summary

### DownloadPdfButton
PDF generation:
- Form validation
- jsPDF document creation
- Screenshot embedding
- Auto-download trigger

## Usage

### For Customers

1. **Access:** Visit `/configurator` route
2. **Customize:**
   - Select bag color from palette
   - Upload logo (PNG, JPG, JPEG, SVG)
   - Adjust logo size and position with sliders
   - Interact with 3D preview (rotate, zoom, pan)
3. **Review:** Enter customer details and quantity
4. **Download:** Click "Download Pricing Contract" to get PDF with 3D mockup

### For Developers

```bash
# Install dependencies
npm install three @react-three/fiber @react-three/drei jspdf html2canvas

# Run dev server
npm run dev

# Visit configurator
# http://localhost:3000/configurator

# Build for production
npm run build
```

## Deployment Notes

### Vercel Compatibility ✅

- ✅ No Node-only dependencies
- ✅ Client-side PDF generation (jsPDF)
- ✅ Dynamic import with `ssr: false` for 3D viewer
- ✅ Canvas/WebGL compatible
- ✅ No database required
- ✅ No authentication needed
- ✅ Fully serverless compatible

### Environment Variables

None required for MVP. The configurator is completely client-side.

### Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari 14+, Chrome Mobile)

## Known Limitations & Future Improvements

### Current Limitations

1. **Logo placement**: front face only (no back/sides/handles yet)
2. **No Persistence**: Data not saved between sessions
3. **No Database**: Customer info not stored
4. **No Checkout**: PDF is endpoint, no order placement
5. **No Email**: No automated email sending of contracts

### Future Enhancement Opportunities

1. **Better 3D Model**
   - Import professional GLB/GLTF bag model
   - Add bag interior details
   - Implement multiple bag sizes
   - Add texture variations

2. **Advanced Logo System**
   - Multiple logo placements (front, back, sides, handles)
   - Pattern/texture overlays

3. **Backend Integration**
   - Save designs to database
   - User accounts & design library
   - Email contract delivery
   - Integrate with CRM (Albadi CRM)
   - WhatsApp integration for sending to customers

4. **eCommerce**
   - Add to cart functionality
   - Payment integration
   - Order tracking
   - Quantity discounts UI

5. **Advanced Controls**
   - Material/finish options
   - Handle style selection
   - Custom text/embroidery
   - Multiple color bags

6. **Analytics**
   - Track configurator usage
   - Popular color preferences
   - Conversion metrics

## Performance Considerations

- **Bundle size**: ~200-250KB (Three.js included)
- **3D rendering**: Runs at 60fps on modern hardware
- **Mobile**: Optimized for tablets and phones
- **Canvas memory**: Single WebGL context, efficient resource usage

## Testing Checklist

- [x] Color palette - all 30+ colors work
- [x] Logo upload - PNG, JPG, SVG tested
- [x] Logo positioning - sliders update in real-time
- [x] 3D viewer - rotates, zooms smoothly
- [x] Form validation - required fields enforced
- [x] Pricing calculation - tiered pricing works
- [x] PDF generation - downloads successfully
- [x] Responsive design - mobile/tablet tested
- [x] No console errors
- [x] Builds for production

## Support & Maintenance

For issues or questions:
1. Check console for TypeScript/runtime errors
2. Verify all dependencies are installed: `npm install`
3. Clear cache: `rm -rf .next node_modules && npm install`
4. Check Three.js compatibility version

## Related Documentation

- [Albadi CRM Main README](/README.md)
- [CRM Architecture Docs](/docs/ARCHITECTURE.md)
- [Bridge Messaging Guide](/docs/CUSTOMER-FLOW.md)

---

**Created:** 2026-06-08
**Status:** MVP Complete ✅
**Next Phase:** Integration with CRM for WhatsApp delivery
