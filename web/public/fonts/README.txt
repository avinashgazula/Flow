Typefaces Flow can be set in (Settings > Appearance). All are under the SIL Open Font License 1.1;
each licence sits next to its files. The default, System, is the device's own font and ships nothing.

inter-latin-wght-normal.woff2     Inter, variable weight, Latin subset      OFL-Inter.txt
                                  from @fontsource-variable/inter 5.3.0
geist-latin-wght-normal.woff2     Geist, variable weight, Latin subset      OFL-Geist.txt
                                  from @fontsource-variable/geist 5.3.0
manrope-latin-wght-normal.woff2   Manrope, variable weight, Latin subset    OFL-Manrope.txt
                                  from @fontsource-variable/manrope 5.3.0
ioskeley-mono-*.woff2             Ioskeley Mono, subset to the characters   OFL-Ioskeley-Mono.txt
                                  Flow shows
barlow-condensed-latin-600-normal.woff2
                                  Barlow Condensed 600, Latin subset        OFL-Barlow-Condensed.txt
                                  from @fontsource/barlow-condensed 5.2.5
                                  (not a Settings choice: the edge print on strips and labels)

Only the file for the chosen typeface is downloaded (plus Barlow Condensed, which every screen with a
strip uses). To update one, `npm pack` its fontsource package
and copy files/<name>-latin-wght-normal.woff2 here; nothing imports the packages at build time.
