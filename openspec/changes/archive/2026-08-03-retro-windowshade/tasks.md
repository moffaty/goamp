## 1. Windowshade

- [x] 1.1 Add a dblclick handler on the titlebar in `retroWindow` toggling `body.style.display`
- [x] 1.2 Tests in `retro.test.ts`: collapse hides body, second dblclick restores, close still fires while collapsed

## 2. Verify

- [x] 2.1 `pnpm test --run` green; `pnpm exec tsc --noEmit` clean
- [x] 2.2 `openspec validate retro-windowshade --strict` passes
