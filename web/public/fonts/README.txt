Marquee's typefaces ("Index", DESIGN.md). All are under the SIL Open Font License 1.1; each licence sits here.
The font files themselves are not in this folder: they come from the @fontsource packages in package.json,
and Vite copies the woff2 files that src/styles/fonts.css names (latin and latin-ext, only the weights used)
into the build with hashed names. Inter, Geist and Manrope are the typefaces Settings > Appearance offers beside
System (the device's own font, which ships nothing) and Mono; they are variable fonts and the browser downloads one
only when the viewer chooses it.

OFL-Archivo.txt              Archivo 700                          @fontsource/archivo
OFL-Plex-Mono.txt            IBM Plex Mono 400, 600               @fontsource/ibm-plex-mono
OFL-Plex-Sans.txt            IBM Plex Sans 600, 700               @fontsource/ibm-plex-sans
OFL-Plex-Serif.txt           IBM Plex Serif 400, 600, 400 italic  @fontsource/ibm-plex-serif
OFL-Inter.txt                Inter, variable weight               @fontsource-variable/inter
OFL-Geist.txt                Geist, variable weight               @fontsource-variable/geist
OFL-Manrope.txt              Manrope, variable weight             @fontsource-variable/manrope
