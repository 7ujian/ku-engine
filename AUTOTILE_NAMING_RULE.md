```
here is an annotation system to decribe the auto tile rule:

0 = Water
1 = Sand

a 2x2 splitted tile can be annotated as "ABCD"
A = Top-left 
B = top-right
C = bottom-left
D = bottom-right

then

0000 = pure water
1111 = pure sand
1000 = water with top-left sand

then

a cross sand island's auto tile data is
0 0 0 0 0
0 0 1 0 0
0 1 1 1 0
0 0 1 0 0
0 0 0 0 0

and it should be resolved as normal tile as

0000 0001 0011 0010 0000 
0001 0111 1111 1011 0010
0101 1111 1111 1111 1010
0100 1101 1111 1110 1000
0000 0100 1100 1000 0000

In the Beach_Tile.atlas.json, the naming relation is

0001: beach_top_left
0011: beach_top_mid
...

1110: beach_pond_top_left
1101: beach_pond_top_right
1011: beach_pond_bottom_left
0111: beach_pond_bottom_right

```
