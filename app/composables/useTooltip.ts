import { nextTick } from "vue";

export interface TooltipOptions {
  delay?: number;
  placement?: "top" | "bottom" | "left" | "right";
  offset?: number;
  className?: string;
}

// Global tooltip state
let tooltipInstance: HTMLElement | null = null;
let currentTarget: HTMLElement | null = null;
let showTimeout: NodeJS.Timeout | null = null;
let hideTimeout: NodeJS.Timeout | null = null;

const clearTimeouts = () => {
  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
};

const createTooltipElement = (): HTMLElement => {
  const tooltip = document.createElement("div");
  tooltip.className =
    "fixed px-2 py-1 text-xs font-medium rounded-md shadow-lg pointer-events-none transition-opacity duration-200 whitespace-nowrap z-[9999] opacity-0";
  tooltip.style.position = "fixed";
  tooltip.style.pointerEvents = "none";
  tooltip.style.backgroundColor = "var(--bg-color)";
  tooltip.style.color = "var(--main-color)";
  tooltip.style.border = "1px solid var(--sub-color)";
  tooltip.style.boxShadow =
    "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
  document.body.appendChild(tooltip);
  return tooltip;
};

const positionTooltip = (
  tooltip: HTMLElement,
  target: HTMLElement,
  placement: string = "top",
  offset: number = 8,
) => {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let top = 0;
  let left = 0;

  switch (placement) {
    case "top":
      top = targetRect.top - tooltipRect.height - offset;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
      break;
    case "bottom":
      top = targetRect.bottom + offset;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
      break;
    case "left":
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      left = targetRect.left - tooltipRect.width - offset;
      break;
    case "right":
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      left = targetRect.right + offset;
      break;
  }

  // Prevent tooltip from going off-screen
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // Adjust horizontal position
  if (left < 8) {
    left = 8;
  } else if (left + tooltipRect.width > viewport.width - 8) {
    left = viewport.width - tooltipRect.width - 8;
  }

  // Adjust vertical position
  if (top < 8) {
    top = 8;
  } else if (top + tooltipRect.height > viewport.height - 8) {
    top = viewport.height - tooltipRect.height - 8;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
};

const showTooltip = (
  target: HTMLElement,
  content: string,
  options: TooltipOptions = {},
) => {
  const {
    delay = 500,
    placement = "top",
    offset = 8,
    className = "",
  } = options;

  clearTimeouts();

  showTimeout = setTimeout(() => {
    // Create tooltip if it doesn't exist
    if (!tooltipInstance) {
      tooltipInstance = createTooltipElement();
    }

    // Set content and show
    tooltipInstance.textContent = content;
    currentTarget = target;

    // Add custom classes if provided
    if (className) {
      tooltipInstance.className += ` ${className}`;
    }

    // Position and show tooltip
    nextTick(() => {
      if (tooltipInstance && currentTarget) {
        positionTooltip(tooltipInstance, currentTarget, placement, offset);
        tooltipInstance.style.opacity = "1";
      }
    });
  }, delay);
};

const hideTooltip = () => {
  clearTimeouts();

  hideTimeout = setTimeout(() => {
    if (tooltipInstance) {
      tooltipInstance.style.opacity = "0";
    }
    currentTarget = null;
  }, 100);
};

export const useTooltip = (defaultOptions: TooltipOptions = {}) => {
  const bindTooltip = (
    element: HTMLElement,
    content: string,
    options?: TooltipOptions,
  ) => {
    const finalOptions = { ...defaultOptions, ...options };

    // Remove existing title attribute to prevent native tooltip
    element.removeAttribute("title");

    const handleMouseEnter = () => showTooltip(element, content, finalOptions);
    const handleMouseLeave = () => hideTooltip();
    const handleFocus = () => showTooltip(element, content, finalOptions);
    const handleBlur = () => hideTooltip();

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);
    element.addEventListener("focus", handleFocus);
    element.addEventListener("blur", handleBlur);

    // Store cleanup function on the element
    interface ElementWithCleanup extends HTMLElement {
      __tooltipCleanup?: () => void;
    }

    (element as ElementWithCleanup).__tooltipCleanup = () => {
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("focus", handleFocus);
      element.removeEventListener("blur", handleBlur);
      clearTimeouts();
    };
  };

  const unbindTooltip = (element: HTMLElement) => {
    interface ElementWithCleanup extends HTMLElement {
      __tooltipCleanup?: () => void;
    }

    const elementWithCleanup = element as ElementWithCleanup;
    if (elementWithCleanup.__tooltipCleanup) {
      elementWithCleanup.__tooltipCleanup();
      delete elementWithCleanup.__tooltipCleanup;
    }
  };

  return {
    bindTooltip,
    unbindTooltip,
  };
};

// Vue directive for easy use in templates
interface DirectiveBinding {
  value:
    | string
    | {
        content?: string;
        delay?: number;
        placement?: string;
        offset?: number;
        className?: string;
      };
}

export const vTooltip = {
  mounted(el: HTMLElement, binding: DirectiveBinding) {
    const { bindTooltip } = useTooltip();

    let content = "";
    let options = { delay: 500 };

    if (typeof binding.value === "string") {
      content = binding.value;
    } else if (typeof binding.value === "object") {
      content = binding.value.content || "";
      options = { ...options, ...binding.value };
    }

    if (content) {
      bindTooltip(el, content, options);
    }
  },

  updated(el: HTMLElement, binding: DirectiveBinding) {
    const { unbindTooltip, bindTooltip } = useTooltip();

    let content = "";
    let options = { delay: 500 };

    if (typeof binding.value === "string") {
      content = binding.value;
    } else if (typeof binding.value === "object") {
      content = binding.value.content || "";
      options = { ...options, ...binding.value };
    }

    unbindTooltip(el);
    if (content) {
      bindTooltip(el, content, options);
    }
  },

  unmounted(el: HTMLElement) {
    const { unbindTooltip } = useTooltip();
    unbindTooltip(el);
  },
};

// Cleanup function for when the page unloads
if (import.meta.client) {
  window.addEventListener("beforeunload", () => {
    clearTimeouts();
    if (tooltipInstance && document.body.contains(tooltipInstance)) {
      document.body.removeChild(tooltipInstance);
      tooltipInstance = null;
    }
  });
}
