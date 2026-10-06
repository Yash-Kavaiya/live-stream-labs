import type { DetailedHTMLProps, HTMLAttributes } from 'react';

import '@material/web/button/elevated-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/dialog/dialog.js';
import '@material/web/divider/divider.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/filled-icon-button.js';
import '@material/web/iconbutton/filled-tonal-icon-button.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/iconbutton/outlined-icon-button.js';
import '@material/web/progress/circular-progress.js';
import '@material/web/progress/linear-progress.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/slider/slider.js';
import '@material/web/switch/switch.js';
import '@material/web/tabs/primary-tab.js';
import '@material/web/tabs/tabs.js';
import '@material/web/textfield/outlined-text-field.js';

/** Material Web custom elements take arbitrary properties; the typed surface is the wrappers. */
type MdElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'md-elevated-button': MdElement;
      'md-filled-button': MdElement;
      'md-filled-tonal-button': MdElement;
      'md-outlined-button': MdElement;
      'md-text-button': MdElement;
      'md-checkbox': MdElement;
      'md-dialog': MdElement;
      'md-divider': MdElement;
      'md-icon': MdElement;
      'md-icon-button': MdElement;
      'md-filled-icon-button': MdElement;
      'md-filled-tonal-icon-button': MdElement;
      'md-outlined-icon-button': MdElement;
      'md-circular-progress': MdElement;
      'md-linear-progress': MdElement;
      'md-outlined-select': MdElement;
      'md-select-option': MdElement;
      'md-slider': MdElement;
      'md-switch': MdElement;
      'md-primary-tab': MdElement;
      'md-tabs': MdElement;
      'md-outlined-text-field': MdElement;
    }
  }
}
