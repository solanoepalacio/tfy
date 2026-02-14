<script lang="ts">
  export let videoUrl = "";
  export let showTooltip = true;
  export let tooltip = "Preview sourced directly from YouTube";
  export let label = "YouTube";

  const href = videoUrl || "#";
  const titleText = showTooltip ? tooltip : undefined;
  const ariaLabel = `${label} attribution badge${showTooltip ? ` · ${tooltip}` : ""}`;
</script>

<a
  class="attribution-banner"
  href={href}
  target="_blank"
  rel="noreferrer"
  title={titleText}
  aria-label={ariaLabel}
>
  <span class="logo" aria-hidden="true">
    <svg viewBox="0 0 24 24" role="presentation">
      <rect x="2" y="6" width="20" height="12" rx="4" fill="#fff" opacity="0.8" />
      <path d="M8 8.5L16 12L8 15.5V8.5Z" fill="#e50914" />
    </svg>
  </span>
  <span class="text">{label}</span>
  {#if showTooltip}
    <span class="hint">{tooltip}</span>
  {/if}
</a>

<style>
  .attribution-banner {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: #1d4ed8;
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 600;
    text-decoration: none;
    line-height: 1;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  }

  .logo {
    width: 1.4rem;
    height: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .logo svg {
    width: 100%;
    height: 100%;
  }

  .text {
    letter-spacing: 0.02em;
  }

  .hint {
    font-size: 0.65rem;
    opacity: 0.85;
    white-space: nowrap;
  }

  .attribution-banner:hover {
    background: #2563eb;
  }
</style>
