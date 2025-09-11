<script setup lang="ts">
/**
 * Deprecated Route Stub: /share/courses/:id
 *
 * This page exists only to maintain backward compatibility with older
 * share links. All course sharing has been unified under /courses/:id.
 *
 * Behavior:
 *  - Immediately redirects (301) to /courses/:id
 *  - Provides a minimal fallback message if the redirect does not fire
 *    (e.g. very old browsers, JS disabled, or transient hydration delay).
 *
 * SEO:
 *  - Marked noindex to avoid search engine indexing of the legacy path.
 */

definePageMeta({
  layout: false,
});

const route = useRoute();
const id = route.params.id as string;

// Perform client-side redirect as early as possible
if (import.meta.client) {
  // Use 301 for permanence; replace to keep history clean
  navigateTo(`/courses/${id}`, { redirectCode: 301, replace: true });
}

useHead({
  title: 'Redirecting...',
  meta: [
    { name: 'robots', content: 'noindex,nofollow' },
    { name: 'refresh', content: `0;url=/courses/${id}` }, // Non-JS fallback
  ],
});
</script>

<template>
  <div
    style="
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
        Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans',
        'Helvetica Neue', Arial, sans-serif;
      padding: 2rem;
      text-align: center;
    "
  >
    <h1
      style="
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0;
        color: #222;
      "
    >
      Redirecting…
    </h1>
    <p style="margin: 0; max-width: 480px; color: #555; line-height: 1.4;">
      This shared course link has moved. If you are not redirected automatically,
      click the button below to continue.
    </p>
    <NuxtLink
      :to="`/courses/${id}`"
      style="
        display: inline-block;
        background: #2563eb;
        color: #fff;
        padding: 0.6rem 1.1rem;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-decoration: none;
      "
    >
      Go to Course
    </NuxtLink>
  </div>
</template>
