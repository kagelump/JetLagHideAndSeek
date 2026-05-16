Current design

Imitating apple maps

Main view - Top is map, bottom is main drawer

# Map

- Go to user location button

# Main Drawer

- Questions
  Opens a stacked drawer
- Add Question
  Modal for question type (including paste), creates question, opens that question drawer
- Settings
  Opens settings drawer

## Question Drawer

Shows 1 questeion

# Settings drawer

- Play Area (OSM ID for outer bounding box, save this as polygon + bbox)
    - Outer bbox
    - Presets for known day passes within bbox (Add all Tokyo Metro, etc)
    - Transit operators
- UI Settings
    - Thunderforest API Keys, etc
    - Default display units (mi, km, m. But default to meters internally)
- Hider mode on/off
- Copy / Paste state (Modal)

## Copy/paste Modal

Checkmark for what data to copy (Play area, UI settings, Questions) or paste.

# Wire Format

JSON with below

- Play Area
- UI
- Question state
- New Question
    - This one is special, sent by seeker when asking question.
