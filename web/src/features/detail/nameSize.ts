/** The step a long name takes down from the full display size, so it breaks between words instead of inside one.
 *  Title pages, people and collections share it (as `data-size`; the CSS has the sizes). */
export const nameSize = (name: string) => (name.length <= 8 ? undefined : name.length <= 16 ? 'long' : name.length <= 28 ? 'longer' : 'longest')
