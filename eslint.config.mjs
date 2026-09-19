import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  { ignores: ['**/.next/**', '**/node_modules/**', '.claude/**'] },
  ...nextCoreWebVitals,
  {
    rules: {
      // New in eslint-plugin-react-hooks v7 (pulled in transitively by the
      // Next 16 eslint-config-next bump). It flags ~27 pre-existing,
      // intentional patterns across this codebase (e.g. resetting page/filter
      // state in a useEffect when a dependency changes, kicking off an async
      // loader on mount). Rewriting all of them is a real behavioral change
      // to a live app and out of scope for this dependency upgrade -
      // deliberately left disabled here; revisit as a dedicated follow-up.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
