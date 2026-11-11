import { isMetered, type Connection } from '../../preferences'

/* When face recognition may use the viewer's data and battery. The models and their runtime are about 15 MB the first time, so they aren't
   fetched on a metered or slow connection (the same test Resolution on Cellular uses), and a look while the film plays isn't
   started with the tab hidden or Data Saver on. */

/** Whether the models may be downloaded. */
export const mayDownload = (connection: Connection | undefined): boolean => !isMetered(connection)

/** Whether to look at the picture again on a timer: only with the tab showing, and not with Data Saver on. */
export const mayFollow = (connection: Connection | undefined, hidden: boolean): boolean => !hidden && connection?.saveData !== true
