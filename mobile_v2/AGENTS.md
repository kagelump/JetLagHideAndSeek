# mobile_v2 Agent Notes

## React Native E2E and Accessibility

Maestro/XCUITest does not test the React component tree. It interacts with the
native iOS accessibility/view hierarchy, which can disagree with JSX, Jest
queries, and screenshots.

Keep these separate when debugging E2E:

- The React tree is what unit tests such as React Native Testing Library see.
- The native view/accessibility tree is what Maestro and XCUITest see.
- A screenshot only proves pixels rendered; it does not prove the element is
  targetable by native automation.

Practical rules:

- If Maestro says an element is missing, inspect the debug hierarchy artifact,
  not just the screenshot.
- Treat bottom sheets, portals, scroll views, maps, native modules, and
  keyboards as translation zones where JSX and native accessibility often
  diverge.
- Put E2E selectors on stable native-accessible interaction targets. For iOS
  `TextInput`, especially when empty, a visible input may not expose the
  expected `testID`; use an accessible wrapper that focuses the real input when
  needed.
- Keep unit-test IDs and E2E IDs aligned in intent, but do not assume a Jest
  `getByTestId` pass guarantees Maestro can find the same node.
- Avoid unnecessary generic keyboard actions in Maestro. iOS number pads may not
  expose a standard dismiss action; if the next control is visible, tap it
  directly.

Accessibility lint is useful as a guardrail for this. It can catch missing
labels, roles, and bad accessibility prop usage, but it cannot prove that iOS
will expose a specific node through XCUITest. Use lint as the typecheck for the
interaction surface, and Maestro as the integration test for that surface.
