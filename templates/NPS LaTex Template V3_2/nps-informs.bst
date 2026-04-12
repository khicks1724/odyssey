%%
%% This is file `nps-informs.bst',
%% generated with the docstrip utility.
%%
%% The original source files were:
%%
%% merlin.mbs  (with options: `ay,nat,nm-rvx,ed-rev,jnrlst,keyxyr,dt-beg,yr-par,yrp-x,note-yr,numser,jnm-x,bkpg-x,add-pub,pub-par,isbn,issn,url-doi,blk-tit,in-x,ppx,ed,xedn,varand,xand,etal-xc,url,url-blk,nfss,')
%% ----------------------------------------
%% *** INFORMS journals new reference style ***
%% 
%% Copyright 1994-2011 Patrick W Daly
 % ===============================================================
 % IMPORTANT NOTICE:
 % This bibliographic style (bst) file has been generated from one or
 % more master bibliographic style (mbs) files, listed above.
 %
 % This generated file can be redistributed and/or modified under the terms
 % of the LaTeX Project Public License Distributed from CTAN
 % archives in directory macros/latex/base/lppl.txt; either
 % version 1 of the License, or any later version.
 % ===============================================================
 % Name and version information of the main mbs file:
 % \ProvidesFile{merlin.mbs}[2011/11/18 4.33 (PWD, AO, DPC)]
 %   For use with BibTeX version 0.99a or later
 %-------------------------------------------------------------------
 % This bibliography style file is intended for texts in ENGLISH
 % This is an author-year citation style bibliography. As such, it is
 % non-standard LaTeX, and requires a special package file to function properly.
 % Such a package is    natbib.sty   by Patrick W. Daly
 % The form of the \bibitem entries is
 %   \bibitem[Jones et al.(1990)]{key}...
 %   \bibitem[Jones et al.(1990)Jones, Baker, and Smith]{key}...
 % The essential feature is that the label (the part in brackets) consists
 % of the author names, as they should appear in the citation, with the year
 % in parentheses following. There must be no space before the opening
 % parenthesis!
 % With natbib v5.3, a full list of authors may also follow the year.
 % In natbib.sty, it is possible to define the type of enclosures that is
 % really wanted (brackets or parentheses), but in either case, there must
 % be parentheses in the label.
 % The \cite command functions as follows:
 %   \citet{key} ==>>                Jones et al. (1990)
 %   \citet*{key} ==>>               Jones, Baker, and Smith (1990)
 %   \citep{key} ==>>                (Jones et al., 1990)
 %   \citep*{key} ==>>               (Jones, Baker, and Smith, 1990)
 %   \citep[chap. 2]{key} ==>>       (Jones et al., 1990, chap. 2)
 %   \citep[e.g.][]{key} ==>>        (e.g. Jones et al., 1990)
 %   \citep[e.g.][p. 32]{key} ==>>   (e.g. Jones et al., 1990, p. 32)
 %   \citeauthor{key} ==>>           Jones et al.
 %   \citeauthor*{key} ==>>          Jones, Baker, and Smith
 %   \citeyear{key} ==>>             1990
 %---------------------------------------------------------------------
 % March 2023 updates by CDR Christopher B. Landis include the following:
%    - Removed URL prefix
%    - Added `ebook`, `patent` types
%    - Removed `booklet` type but added alias for it to `book` type
%    - Added forced et al. capability
%    - Fixed year not appearing in \citet and \citep output when there are no authors
%    - Added aliases for `software` and `video` types
%    - Many other minor tweaks to align the style with https://libguides.nps.edu/citation/informs

ENTRY
  { address
    author
    booktitle
    chapter
    doi
    edition
    editor
    eid
    howpublished
    institution
    isbn
    issn
    journal
    key
    month
    nationality
    note
    number
    organization
    pages
    publisher
    school
    series
    title
    type
    url
    volume
    year
  }
  {}
  { label extra.label sort.label short.list }
INTEGERS { output.state before.all mid.sentence after.sentence after.block }
FUNCTION {init.state.consts}
{ #0 'before.all :=
  #1 'mid.sentence :=
  #2 'after.sentence :=
  #3 'after.block :=
}
STRINGS { s t}
FUNCTION {output.nonnull}
{ 's :=
  output.state mid.sentence =
    { ", " * write$ }
    { output.state after.block =
        { add.period$ write$
          newline$
          "\newblock " write$
        }
        { output.state before.all =
            'write$
            { add.period$ " " * write$ }
          if$
        }
      if$
      mid.sentence 'output.state :=
    }
  if$
  s
}
FUNCTION {output}
{ duplicate$ empty$
    'pop$
    'output.nonnull
  if$
}
FUNCTION {output.check}
{ 't :=
  duplicate$ empty$
    { pop$ "empty " t * " in " * cite$ * warning$ }
    'output.nonnull
  if$
}
FUNCTION {fin.entry}
{ add.period$
  write$
  newline$
}

FUNCTION {new.block}
{ output.state before.all =
    'skip$
    { after.block 'output.state := }
  if$
}
FUNCTION {new.sentence}
{ output.state after.block =
    'skip$
    { output.state before.all =
        'skip$
        { after.sentence 'output.state := }
      if$
    }
  if$
}
FUNCTION {add.blank}
{  " " * before.all 'output.state :=
}

FUNCTION {date.block}
{
  add.blank
}

FUNCTION {not}
{   { #0 }
    { #1 }
  if$
}
FUNCTION {and}
{   'skip$
    { pop$ #0 }
  if$
}
FUNCTION {or}
{   { pop$ #1 }
    'skip$
  if$
}
STRINGS {z}

FUNCTION {remove.dots}
{ 'z :=
   ""
   { z empty$ not }
   { z #1 #2 substring$
     duplicate$ "\." =
       { z #3 global.max$ substring$ 'z :=  * }
       { pop$
         z #1 #1 substring$
         z #2 global.max$ substring$ 'z :=
         duplicate$ "." = 'pop$
           { * }
         if$
       }
     if$
   }
   while$
}
FUNCTION {new.block.checkb}
{ empty$
  swap$ empty$
  and
    'skip$
    'new.block
  if$
}
FUNCTION {field.or.null}
{ duplicate$ empty$
    { pop$ "" }
    'skip$
  if$
}
FUNCTION {emphasize}
{ duplicate$ empty$
    { pop$ "" }
    { "\emph{" swap$ * "}" * }
  if$
}
FUNCTION {tie.or.space.prefix}
{ duplicate$ text.length$ #3 <
    { "~" }
    { " " }
  if$
  swap$
}

FUNCTION {capitalize}
{ "u" change.case$ "t" change.case$ }

FUNCTION {space.word}
{ " " swap$ * " " * }
 % Here are the language-specific definitions for explicit words.
 % Each function has a name bbl.xxx where xxx is the English word.
 % The language selected here is ENGLISH
FUNCTION {bbl.and}
{ "\protect\BIBand{}"}

FUNCTION {bbl.etal}
{ "et~al." }

FUNCTION {bbl.editors}
{ "eds." }

FUNCTION {bbl.editor}
{ "ed." }

FUNCTION {bbl.edby}
{ "edited by" }

FUNCTION {bbl.edition}
{ "ed." }

FUNCTION {bbl.volume}
{ "volume" }

FUNCTION {bbl.of}
{ "of" }

FUNCTION {bbl.number}
{ "number" }

FUNCTION {bbl.nr}
{ "no." }

FUNCTION {bbl.in}
{ "in" }

FUNCTION {bbl.pages}
{ "" }

FUNCTION {bbl.page}
{ "" }

FUNCTION {bbl.chapter}
{ "chapter" }

FUNCTION {bbl.techrep}
{ "Technical Report" }

FUNCTION {bbl.mthesis}
{ "Master's thesis" }

FUNCTION {bbl.phdthesis}
{ "Doctoral dissertation" }

MACRO {jan} {"January"}

MACRO {feb} {"February"}

MACRO {mar} {"March"}

MACRO {apr} {"April"}

MACRO {may} {"May"}

MACRO {jun} {"June"}

MACRO {jul} {"July"}

MACRO {aug} {"August"}

MACRO {sep} {"September"}

MACRO {oct} {"October"}

MACRO {nov} {"November"}

MACRO {dec} {"December"}

MACRO {acmcs} {"ACM Computing Surveys"}

MACRO {acta} {"Acta Informatica"}

MACRO {cacm} {"Communications of the ACM"}

MACRO {ibmjrd} {"IBM Journal of Research and Development"}

MACRO {ibmsj} {"IBM Systems Journal"}

MACRO {ieeese} {"IEEE Transactions on Software Engineering"}

MACRO {ieeetc} {"IEEE Transactions on Computers"}

MACRO {ieeetcad}
 {"IEEE Transactions on Computer-Aided Design of Integrated Circuits"}

MACRO {ipl} {"Information Processing Letters"}

MACRO {jacm} {"Journal of the ACM"}

MACRO {jcss} {"Journal of Computer and System Sciences"}

MACRO {scp} {"Science of Computer Programming"}

MACRO {sicomp} {"SIAM Journal on Computing"}

MACRO {tocs} {"ACM Transactions on Computer Systems"}

MACRO {tods} {"ACM Transactions on Database Systems"}

MACRO {tog} {"ACM Transactions on Graphics"}

MACRO {toms} {"ACM Transactions on Mathematical Software"}

MACRO {toois} {"ACM Transactions on Office Information Systems"}

MACRO {toplas} {"ACM Transactions on Programming Languages and Systems"}

MACRO {tcs} {"Theoretical Computer Science"}
FUNCTION {bibinfo.check}
{ swap$
  duplicate$ missing$
    {
      pop$ pop$
      ""
    }
    { duplicate$ empty$
        {
          swap$ pop$
        }
        { swap$
          pop$
        }
      if$
    }
  if$
}
FUNCTION {bibinfo.warn}
{ swap$
  duplicate$ missing$
    {
      swap$ "missing " swap$ * " in " * cite$ * warning$ pop$
      ""
    }
    { duplicate$ empty$
        {
          swap$ "empty " swap$ * " in " * cite$ * warning$
        }
        { swap$
          pop$
        }
      if$
    }
  if$
}
FUNCTION {format.url}
{ mid.sentence 'output.state :=
  doi empty$
    { url }
    { "https://doi.org/" doi * }
  if$
  duplicate$ empty$
    { pop$ "" }
    { "\url{" swap$ * "}" * }
  if$
}

INTEGERS { nameptr namesleft numnames }


STRINGS  { bibinfo}

% #0 turns off the forced use of "et al."
% #1 enables
FUNCTION {is.forced.et.al} { #1 }

% The maximum number of names that can be present beyond which an "et al."
% usage is forced. Be sure that num.names.shown.with.forced.et.al (below)
% is not greater than this value!
FUNCTION {max.num.names.before.forced.et.al} { #10 }

% The number of names that will be shown with a forced "et al.".
% Must be less than or equal to max.num.names.before.forced.et.al
FUNCTION {num.names.shown.with.forced.et.al} { #7 }


FUNCTION {format.names}
{ 'bibinfo :=
  duplicate$ empty$ 'skip$ {
  's :=
  "" 't :=
  #1 'nameptr :=
  s num.names$ 'numnames :=
  numnames 'namesleft :=
    { namesleft #0 > }
    { s nameptr
      "{vv~}{ll}{ f{}}{ jj}"
      format.name$
      remove.dots
      bibinfo bibinfo.check
      't :=
      nameptr #1 >
        { nameptr num.names.shown.with.forced.et.al #1 + =
          numnames max.num.names.before.forced.et.al >
          is.forced.et.al and and
            { "others" 't :=
              #1 'namesleft :=
            }
            { skip$ }
          if$
          namesleft #1 >
            { ", " * t * }
            {
              s nameptr "{ll}" format.name$ duplicate$ "others" =
                { 't := }
                { pop$ }
              if$
              "," *
              t "others" =
                {
                  " " * bbl.etal emphasize *
                }
                { " " * t * }
              if$
            }
          if$
        }
        't
      if$
      nameptr #1 + 'nameptr :=
      namesleft #1 - 'namesleft :=
    }
  while$
  } if$
}
FUNCTION {format.names.ed}
{
  format.names
}
FUNCTION {format.key}
{ empty$
    { key field.or.null }
    { "" }
  if$
}

FUNCTION {format.authors}
{ author "author" format.names
}
FUNCTION {get.bbl.editor}
{ editor num.names$ #1 > 'bbl.editors 'bbl.editor if$ }

FUNCTION {format.editors}
{ editor "editor" format.names duplicate$ empty$ 'skip$
    {
      "," *
      " " *
      get.bbl.editor
      *
    }
  if$
}
FUNCTION {format.isbn}
{ isbn "isbn" bibinfo.check
  duplicate$ empty$ 'skip$
    {
      "ISBN " swap$ *
    }
  if$
}

FUNCTION {format.issn}
{ issn "issn" bibinfo.check
  duplicate$ empty$ 'skip$
    {
      "ISSN " swap$ *
    }
  if$
}

FUNCTION {format.note}
{
 note empty$
    { "" }
    { note #1 #1 substring$
      duplicate$ "{" =
        'skip$
        { output.state mid.sentence =
          { "l" }
          { "u" }
        if$
        change.case$
        }
      if$
      note #2 global.max$ substring$ * "note" bibinfo.check
    }
  if$
}

FUNCTION {format.first.ltr.upper}
{ duplicate$ empty$ 'skip$ {
  duplicate$ #1 #1 substring$
  duplicate$ "{" = %comment for "}" closure
    'skip$
    { output.state mid.sentence = not
      { "u" change.case$ }
      'skip$
    if$ }
  if$
  swap$ #2 global.max$ substring$ *
} if$
}

FUNCTION {format.title}
{ title
  duplicate$ empty$ 'skip$
    { "t" change.case$ }
  if$
  "title" bibinfo.check
}
FUNCTION {format.full.names}
{'s :=
 "" 't :=
  #1 'nameptr :=
  s num.names$ 'numnames :=
  numnames 'namesleft :=
    { namesleft #0 > }
    { s nameptr
      "{vv~}{ll}" format.name$
      't :=
      nameptr #1 >
        {
          namesleft #1 >
            { ", " * t * }
            {
              s nameptr "{ll}" format.name$ duplicate$ "others" =
                { 't := }
                { pop$ }
              if$
              t "others" =
                {
                  " " * bbl.etal *
                }
                {
                  numnames #2 >
                    { "," * }
                    'skip$
                  if$
                  bbl.and
                  space.word * t *
                }
              if$
            }
          if$
        }
        't
      if$
      nameptr #1 + 'nameptr :=
      namesleft #1 - 'namesleft :=
    }
  while$
}

FUNCTION {author.editor.key.full}
{ author empty$
    { editor empty$
        { key empty$
            { cite$ #1 #3 substring$ }
            'key
          if$
        }
        { editor format.full.names }
      if$
    }
    { author format.full.names }
  if$
}

FUNCTION {author.key.full}
{ author empty$
    { key empty$
         { cite$ #1 #3 substring$ }
          'key
      if$
    }
    { author format.full.names }
  if$
}

FUNCTION {editor.key.full}
{ editor empty$
    { key empty$
         { cite$ #1 #3 substring$ }
          'key
      if$
    }
    { editor format.full.names }
  if$
}

FUNCTION {make.full.names}
{ type$ "book" =
  type$ "inbook" =
  or
    'author.editor.key.full
    { type$ "proceedings" =
        'editor.key.full
        'author.key.full
      if$
    }
  if$
}

FUNCTION {output.bibitem}
{ newline$
  "\bibitem[{" write$
  label write$
  ")" make.full.names duplicate$ short.list =
     { pop$ }
     { * }
   if$
  "}]{" * write$
  cite$ write$
  "}" write$
  newline$
  ""
  before.all 'output.state :=
}

FUNCTION {n.dashify}
{
  't :=
  ""
    { t empty$ not }
    { t #1 #1 substring$ "-" =
        { t #1 #2 substring$ "--" = not
            { "--" *
              t #2 global.max$ substring$ 't :=
            }
            {   { t #1 #1 substring$ "-" = }
                { "-" *
                  t #2 global.max$ substring$ 't :=
                }
              while$
            }
          if$
        }
        { t #1 #1 substring$ *
          t #2 global.max$ substring$ 't :=
        }
      if$
    }
  while$
}

FUNCTION {word.in}
{ "" }

% pushes true if the single char string on the stack is in the
% range of "0" to "9"
FUNCTION {is.num}
{ chr.to.int$
  duplicate$ "0" chr.to.int$ < not
  swap$ "9" chr.to.int$ > not and
}

% IEEE separates large numbers with more than 4 digits into groups of
% three. Typical applications include patent and page numbers.

% number of consecutive digits required to trigger the group separation.
FUNCTION {large.number.trigger}{ #5 }

% For numbers longer than the trigger, this is the blocksize of the groups.
% The blocksize must be less than the trigger threshold, and 2 * blocksize
% must be greater than the trigger threshold (can't do more than one
% separation on the initial trigger).
FUNCTION {large.number.blocksize}{ #3 }

% What is actually inserted between the number groups.
FUNCTION {large.number.separator}{ "," }

% So as to save on integer variables by reusing existing ones, numnames
% holds the current number of consecutive digits read and nameptr holds
% the number that will trigger an inserted space.
FUNCTION {large.number.separate}
{ 't :=
  ""
  #0 'numnames :=
  large.number.trigger 'nameptr :=
  { t empty$ not }
  { t #-1 #1 substring$ is.num
      { numnames #1 + 'numnames := }
      { #0 'numnames := 
        large.number.trigger 'nameptr :=
      }
    if$
    t #-1 #1 substring$ swap$ *
    t #-2 global.max$ substring$ 't :=
    numnames nameptr =
      { duplicate$ #1 nameptr large.number.blocksize - substring$ swap$
        nameptr large.number.blocksize - #1 + global.max$ substring$
        large.number.separator swap$ * *
        nameptr large.number.blocksize - 'numnames :=
        large.number.blocksize #1 + 'nameptr :=
      }
      { skip$ }
    if$
  }
  while$
}

FUNCTION {format.date}
{ year "year" bibinfo.check duplicate$ empty$
    {
      "empty year in " cite$ * "; set to ????" * warning$
       pop$ "????"
    }
    'skip$
  if$
  extra.label *
  before.all 'output.state :=
  " (" swap$ * ")" *
}
FUNCTION {format.btitle}
{ title "title" bibinfo.check
  duplicate$ empty$ 'skip$
    {
      emphasize
    }
  if$
}
FUNCTION {either.or.check}
{ empty$
    'pop$
    { "can't use both " swap$ * " fields in " * cite$ * warning$ }
  if$
}
FUNCTION {format.bvolume}
{ volume empty$
    { "" }
    { bbl.volume volume tie.or.space.prefix
      "volume" bibinfo.check * *
      series "series" bibinfo.check
      duplicate$ empty$ 'pop$
        { swap$ bbl.of space.word * swap$
          emphasize * }
      if$
      "volume and number" number either.or.check
    }
  if$
}
FUNCTION {format.number.series}
{ volume empty$
    { number empty$
        { series field.or.null }
        { output.state mid.sentence =
            { bbl.number }
            { bbl.number capitalize }
          if$
          number tie.or.space.prefix "number" bibinfo.check * *
          series empty$
            { "there's a number but no series in " cite$ * warning$ }
            { bbl.in space.word *
              series "series" bibinfo.check *
            }
          if$
        }
      if$
    }
    { "" }
  if$
}

FUNCTION {format.edition}
{ edition duplicate$ empty$ 'skip$
    {
      output.state mid.sentence =
        { "l" }
        { "t" }
      if$ change.case$
      "edition" bibinfo.check
      " " * bbl.edition *
    }
  if$
}
INTEGERS { multiresult }
FUNCTION {multi.page.check}
{ 't :=
  #0 'multiresult :=
    { multiresult not
      t empty$ not
      and
    }
    { t #1 #1 substring$
      duplicate$ "-" =
      swap$ duplicate$ "," =
      swap$ "+" =
      or or
        { #1 'multiresult := }
        { t #2 global.max$ substring$ 't := }
      if$
    }
  while$
  multiresult
}
FUNCTION {format.pages}
{ pages duplicate$ empty$ 'skip$
    { duplicate$ multi.page.check
        {
          n.dashify
        }
        {
        }
      if$
      "pages" bibinfo.check
    }
  if$
}
FUNCTION {format.journal.pages}
{ pages duplicate$ empty$ 'pop$
    { swap$ duplicate$ empty$
        { pop$ pop$ format.pages }
        {
          ":" *
          swap$
          n.dashify
          "pages" bibinfo.check
          *
        }
      if$
    }
  if$
}
FUNCTION {format.journal.eid}
{ eid "eid" bibinfo.check
  duplicate$ empty$ 'pop$
    { swap$ duplicate$ empty$ 'skip$
      {
          ":" *
      }
      if$
      swap$ *
    }
  if$
}
FUNCTION {format.vol.num.pages}
{ volume field.or.null
  duplicate$ empty$ 'skip$
    {
      "volume" bibinfo.check
    }
  if$
  number "number" bibinfo.check duplicate$ empty$ 'skip$
    {
      swap$ duplicate$ empty$
        { "there's a number but no volume in " cite$ * warning$ }
        'skip$
      if$
      swap$
      "(" swap$ * ")" *
    }
  if$ *
  eid empty$
    { format.journal.pages }
    { format.journal.eid }
  if$
}

FUNCTION {format.chapter.pages}
{ chapter empty$
    'format.pages
    { type empty$
        { bbl.chapter }
        { type "l" change.case$
          "type" bibinfo.check
        }
      if$
      chapter tie.or.space.prefix
      "chapter" bibinfo.check
      * *
      pages empty$
        'skip$
        { ", " * format.pages * }
      if$
    }
  if$
}

FUNCTION {format.booktitle}
{
  booktitle "booktitle" bibinfo.check
  emphasize
}
FUNCTION {format.in.ed.booktitle}
{ format.booktitle duplicate$ empty$ 'skip$
    {
      editor "editor" format.names.ed duplicate$ empty$ 'pop$
        {
          "," *
          " " *
          get.bbl.editor
          ", " *
          * swap$
          * }
      if$
      word.in swap$ *
    }
  if$
}
FUNCTION {format.thesis.type}
{ type duplicate$ empty$
    'pop$
    { swap$ pop$
      "t" change.case$ "type" bibinfo.check
    }
  if$
}
FUNCTION {format.tr.number}
{ number "number" bibinfo.check
  type duplicate$ empty$
    { pop$ bbl.techrep }
    'skip$
  if$
  "type" bibinfo.check
  swap$ duplicate$ empty$
    { pop$ "t" change.case$ }
    { tie.or.space.prefix * * }
  if$
}
FUNCTION {format.article.crossref}
{
  word.in
  " \cite{" * crossref * "}" *
}
FUNCTION {format.book.crossref}
{ volume duplicate$ empty$
    { "empty volume in " cite$ * "'s crossref of " * crossref * warning$
      pop$ word.in
    }
    { bbl.volume
      capitalize
      swap$ tie.or.space.prefix "volume" bibinfo.check * * bbl.of space.word *
    }
  if$
  " \cite{" * crossref * "}" *
}
FUNCTION {format.incoll.inproc.crossref}
{
  word.in
  " \cite{" * crossref * "}" *
}
FUNCTION {format.org.or.pub}
{ 't :=
  ""
  address empty$ t empty$ and
    'skip$
    {
      add.blank "(" *
      t *
      address empty$
        'skip$
        { t empty$
            'skip$
            { ", " * }
          if$
          address "address" bibinfo.check *
        }
      if$
      ")" *
    }
  if$
}
FUNCTION {format.publisher.address}
{ publisher "publisher" bibinfo.warn format.org.or.pub
}

FUNCTION {format.organization.address}
{ organization "organization" bibinfo.check format.org.or.pub
}

FUNCTION {format.patent.nationality.type.number}
{ nationality duplicate$ empty$
    { "nationality" bibinfo.warn pop$ "" }
    { "nationality" bibinfo.check
      duplicate$ "l" change.case$ "united states" =
        { pop$ "U.S." }
        { skip$ }
      if$
      " " *
    }
  if$
  type empty$
    { "Patent" "type" bibinfo.check }
    { type "type" bibinfo.check }
  if$  
  *
  number empty$
    { "number" bibinfo.warn }
    { " No." * number "number" bibinfo.check
      large.number.separate
      swap$ " " * swap$ *
    }
  if$ 
}

FUNCTION {format.month}
{ month duplicate$ empty$
    'skip$
    {
      duplicate$ text.length$ #1 substring$ "," =
        { month #1 month text.length$ #1 - substring$ }
        { month }
      if$
    }
  if$
}

FUNCTION {article}
{ output.bibitem
  author empty$ key empty$ not and
    { key title =
      { format.title "title" output.check }
      { key journal =
        { journal "journal" bibinfo.check emphasize "journal" output.check }
        { format.key output }
        if$ }
      if$ }
    { format.authors "author" output.check }
  if$
  format.date "year" output.check
  date.block
  author empty$ key empty$ not and
    { key title =
      'skip$
      { format.title "title" output.check }
    if$ }
    { format.title "title" output.check }
  if$
  new.sentence
  crossref missing$
    {
      author empty$ key empty$ not and
        { key journal =
          'skip$
          { journal "journal" bibinfo.check emphasize "journal" output.check }
        if$ }
        { journal "journal" bibinfo.check emphasize "journal" output.check }
      if$
      volume empty$ number empty$ and pages empty$ and month empty$ and
        'skip$
        'add.blank
      if$
      format.vol.num.pages output
      month empty$
        'skip$
        { add.blank "(" format.month * ")" * output }
      if$
    }
    { format.article.crossref output.nonnull
      format.pages output
    }
  if$
  note empty$
    'skip$
    'new.sentence
  if$
  format.note output
  note empty$
    'skip$
    'new.sentence
  if$
  format.url output
  fin.entry
}
FUNCTION {book}
{ output.bibitem
  author empty$
    { format.editors "author and editor" output.check
      editor format.key output
    }
    { format.authors output.nonnull
      crossref missing$
        { "author and editor" editor either.or.check }
        'skip$
      if$
    }
  if$
  format.date "year" output.check
  date.block
  format.btitle "title" output.check
  format.edition output
  crossref missing$
    { format.bvolume output
  new.sentence
      format.number.series output
      format.publisher.address output
    }
    {
  new.sentence
      format.book.crossref output.nonnull
    }
  if$
  format.url output
  format.note output
  fin.entry
}
FUNCTION {ebook}
{ output.bibitem
  author empty$
    { format.editors "author and editor" output.check
      editor format.key output
    }
    { format.authors output.nonnull
      crossref missing$
        { "author and editor" editor either.or.check }
        'skip$
      if$
    }
  if$
  format.date "year" output.check
  date.block
  format.btitle "title" output.check
  format.edition output
  crossref missing$
    { format.bvolume output
  new.sentence
      format.number.series output
    }
    {
  new.sentence
      format.book.crossref output.nonnull
    }
  if$
  format.url output
  format.note output
  fin.entry
}
FUNCTION {inbook}
{ output.bibitem
  author empty$
    { format.editors "author and editor" output.check
      editor format.key output
    }
    { format.authors output.nonnull
      crossref missing$
        { "author and editor" editor either.or.check }
        'skip$
      if$
    }
  if$
  format.date "year" output.check
  date.block
  format.btitle "title" output.check
  crossref missing$
    {
      format.bvolume output
      format.chapter.pages "chapter and pages" output.check
  new.sentence
      format.number.series output
      format.publisher.address output
    }
    {
      format.chapter.pages "chapter and pages" output.check
  new.sentence
      format.book.crossref output.nonnull
    }
  if$
  format.edition output
  crossref missing$
    { format.isbn output }
    'skip$
  if$
  format.url output
  format.note output
  fin.entry
}

FUNCTION {incollection}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title "title" output.check
  new.sentence
  crossref missing$
    { format.in.ed.booktitle "booktitle" output.check
      format.bvolume output
      format.number.series output
      format.edition output
      format.publisher.address output
      format.chapter.pages output
    }
    { format.incoll.inproc.crossref output.nonnull
      format.chapter.pages output
    }
  if$
  format.url output
  format.note output
  fin.entry
}
FUNCTION {inproceedings}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title "title" output.check
  new.sentence
  crossref missing$
    { format.in.ed.booktitle "booktitle" output.check
      format.bvolume output
      format.number.series output
      publisher empty$
        { format.organization.address output }
        { organization "organization" bibinfo.check output
          format.publisher.address output
        }
      if$
      format.pages output
    }
    { format.incoll.inproc.crossref output.nonnull
      format.pages output
    }
  if$
  format.url output
  format.note output
  fin.entry
}
FUNCTION {conference} { inproceedings }
FUNCTION {manual}
{ output.bibitem
  author empty$
    { organization "organization" bibinfo.check output
      organization format.key output }
    { format.authors output }
  if$
  format.date "year" output.check
  date.block
  format.btitle "title" output.check
  format.edition output
  new.sentence
  howpublished output
  author empty$
    'skip$
    { organization "organization" bibinfo.check output }
  if$
  address "address" bibinfo.check output
  journal empty$
    'skip$
    { "(" swap$ * ")" * }
  if$
  format.url output
  format.note output
  fin.entry
}

FUNCTION {mastersthesis}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title
  "title" output.check
  new.sentence
  bbl.mthesis format.thesis.type output.nonnull
  school "school" bibinfo.warn output
  address "address" bibinfo.check output
  new.sentence
  format.url output
  format.note output
  fin.entry
}

FUNCTION {misc}
{ output.bibitem
  author empty$
    { howpublished format.first.ltr.upper "howpublished" bibinfo.check output }
    { format.authors output
      author format.key output }
  if$
  format.date "year" output.check
  date.block
  format.title output
  type$ "software" =
    'skip$
    'new.sentence
  if$
  author empty$
    'skip$
    { howpublished format.first.ltr.upper "howpublished" bibinfo.check output }
  if$
  organization output
  journal empty$
    'skip$
    { address empty$
      'skip$
      'new.sentence
    if$ }
  if$
  address output
  format.month output
  note empty$
    'skip$
    { new.sentence format.note output }
  if$
  format.url output
  fin.entry
}
FUNCTION {patent}
{ output.bibitem
  format.authors output
  author format.key output
  format.date "year" output.check
  date.block
  format.patent.nationality.type.number output
  new.sentence
  address output
  format.note output
  format.url output
  fin.entry
}
FUNCTION {phdthesis}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title
  "title" output.check
  new.sentence
  bbl.phdthesis format.thesis.type output.nonnull
  school "school" bibinfo.warn output
  address "address" bibinfo.check output
  new.sentence
  format.url output
  format.note output
  fin.entry
}

FUNCTION {proceedings}
{ output.bibitem
  format.editors output
  editor format.key output
  format.date "year" output.check
  date.block
  format.btitle "title" output.check
  format.bvolume output
  format.number.series output
  publisher empty$
    { format.organization.address output }
    { organization "organization" bibinfo.check output
      format.publisher.address output
    }
  if$
  format.isbn output
  format.issn output
  format.url output
  format.note output
  fin.entry
}
FUNCTION {software} {misc}
FUNCTION {techreport}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title
  "title" output.check
  new.sentence
  format.tr.number output.nonnull
  institution "institution" bibinfo.warn output
  address "address" bibinfo.check output
  format.url output
  format.note output
  fin.entry
}

FUNCTION {unpublished}
{ output.bibitem
  format.authors "author" output.check
  author format.key output
  format.date "year" output.check
  date.block
  format.title "title" output.check
  note empty$
    'skip$
    'new.sentence
  if$
  format.note "note" output.check
  format.url output
  fin.entry
}
FUNCTION {video}{misc}
FUNCTION {default.type} { misc }
READ
FUNCTION {sortify}
{ purify$
  "l" change.case$
}
INTEGERS { len }
FUNCTION {chop.word}
{ 's :=
  'len :=
  s #1 len substring$ =
    { s len #1 + global.max$ substring$ }
    's
  if$
}
FUNCTION {format.lab.names}
{ 's :=
  "" 't :=
  s #1 "{vv~}{ll}" format.name$
  s num.names$ duplicate$
  #2 >
    { pop$
      " " * bbl.etal *
    }
    { #2 <
        'skip$
        { s #2 "{ff }{vv }{ll}{ jj}" format.name$ "others" =
            {
              " " * bbl.etal *
            }
            { bbl.and space.word * s #2 "{vv~}{ll}" format.name$
              * }
          if$
        }
      if$
    }
  if$
}

FUNCTION {author.key.label}
{ author empty$
    { key empty$
        { cite$ #1 #3 substring$ }
        'key
      if$
    }
    { author format.lab.names }
  if$
}

FUNCTION {author.editor.key.label}
{ author empty$
    { editor empty$
        { key empty$
            { cite$ #1 #3 substring$ }
            'key
          if$
        }
        { editor format.lab.names }
      if$
    }
    { author format.lab.names }
  if$
}

FUNCTION {editor.key.label}
{ editor empty$
    { key empty$
        { cite$ #1 #3 substring$ }
        'key
      if$
    }
    { editor format.lab.names }
  if$
}

FUNCTION {calc.short.authors}
{ type$ "book" =
  type$ "inbook" =
  or
    'author.editor.key.label
    { type$ "proceedings" =
        'editor.key.label
        'author.key.label
      if$
    }
  if$
  'short.list :=
}

FUNCTION {calc.label}
{ calc.short.authors
  short.list
  "("
  *
  year duplicate$ empty$
  %short.list key field.or.null = or
     { pop$ "" }
     'skip$
  if$
  *
  'label :=
}

FUNCTION {sort.format.names}
{ 's :=
  #1 'nameptr :=
  ""
  s num.names$ 'numnames :=
  numnames 'namesleft :=
    { namesleft #0 > }
    { s nameptr
      "{vv{ } }{ll{ }}{  f{ }}{  jj{ }}"
      format.name$ 't :=
      nameptr #1 >
        {
          "   "  *
          namesleft #1 = t "others" = and
            { "zzzzz" 't := }
            'skip$
          if$
          t sortify *
        }
        { t sortify * }
      if$
      nameptr #1 + 'nameptr :=
      namesleft #1 - 'namesleft :=
    }
  while$
}

FUNCTION {sort.format.title}
{ 't :=
  "A " #2
    "An " #3
      "The " #4 t chop.word
    chop.word
  chop.word
  sortify
  #1 global.max$ substring$
}
FUNCTION {author.sort}
{ author empty$
    { key empty$
        { "to sort, need author or key in " cite$ * warning$
          ""
        }
        { key sortify }
      if$
    }
    { author sort.format.names }
  if$
}
FUNCTION {author.editor.sort}
{ author empty$
    { editor empty$
        { key empty$
            { "to sort, need author, editor, or key in " cite$ * warning$
              ""
            }
            { key sortify }
          if$
        }
        { editor sort.format.names }
      if$
    }
    { author sort.format.names }
  if$
}
FUNCTION {editor.sort}
{ editor empty$
    { key empty$
        { "to sort, need editor or key in " cite$ * warning$
          ""
        }
        { key sortify }
      if$
    }
    { editor sort.format.names }
  if$
}
FUNCTION {presort}
{ calc.label
  label sortify
  "    "
  *
  type$ "book" =
  type$ "inbook" =
  or
    'author.editor.sort
    { type$ "proceedings" =
        'editor.sort
        'author.sort
      if$
    }
  if$
  #1 entry.max$ substring$
  'sort.label :=
  sort.label
  *
  "    "
  *
  title field.or.null
  sort.format.title
  *
  #1 entry.max$ substring$
  'sort.key$ :=
}

ITERATE {presort}
SORT
STRINGS { last.label next.extra }
INTEGERS { last.extra.num last.extra.num.extended last.extra.num.blank number.label }
FUNCTION {initialize.extra.label.stuff}
{ #0 int.to.chr$ 'last.label :=
  "" 'next.extra :=
  #0 'last.extra.num :=
  "a" chr.to.int$ #1 - 'last.extra.num.blank :=
  last.extra.num.blank 'last.extra.num.extended :=
  #0 'number.label :=
}
FUNCTION {forward.pass}
{ last.label label =
    { last.extra.num #1 + 'last.extra.num :=
      last.extra.num "z" chr.to.int$ >
       { "a" chr.to.int$ 'last.extra.num :=
         last.extra.num.extended #1 + 'last.extra.num.extended :=
       }
       'skip$
      if$
      last.extra.num.extended last.extra.num.blank >
        { last.extra.num.extended int.to.chr$
          last.extra.num int.to.chr$
          * 'extra.label := }
        { last.extra.num int.to.chr$ 'extra.label := }
      if$
    }
    { "a" chr.to.int$ 'last.extra.num :=
      "" 'extra.label :=
      label 'last.label :=
    }
  if$
  number.label #1 + 'number.label :=
}
FUNCTION {reverse.pass}
{ next.extra "b" =
    { "a" 'extra.label := }
    'skip$
  if$
  extra.label 'next.extra :=
  extra.label
  duplicate$ empty$
    'skip$
    { "{\natexlab{" swap$ * "}}" * }
  if$
  'extra.label :=
  label extra.label * 'label :=
}
EXECUTE {initialize.extra.label.stuff}
ITERATE {forward.pass}
REVERSE {reverse.pass}
FUNCTION {bib.sort.order}
{ sort.label
  "    "
  *
  year field.or.null sortify
  *
  "    "
  *
  title field.or.null
  sort.format.title
  *
  #1 entry.max$ substring$
  'sort.key$ :=
}
ITERATE {bib.sort.order}
SORT
FUNCTION {begin.bib}
{ preamble$ empty$
    'skip$
    { preamble$ write$ newline$ }
  if$
  "\begin{thebibliography}{" number.label int.to.str$ * "}" *
  write$ newline$
  "\providecommand{\natexlab}[1]{#1}"
  write$ newline$
  "\providecommand{\url}[1]{\texttt{#1}}"
  write$ newline$
}
EXECUTE {begin.bib}
EXECUTE {init.state.consts}
ITERATE {call.type$}
FUNCTION {end.bib}
{ newline$
  "\end{thebibliography}" write$ newline$
}
EXECUTE {end.bib}
%% End of customized bst file
%%
%% End of file.
