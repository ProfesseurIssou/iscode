# ISCode Support 0.1.1
## Translate
Open your ISCode file
Press CTRL+SHIFT+P and type :
```
ISCode : Translate code
```
And press ENTER
Select the output format and wait

<br>
<br>
<br>
<br>


## Create or Add my own translation
1. Press CTRL+SHIFT+P and type :
```
ISCode : Open translate folder
```
2. And press ENTER

#### Import a translation :
3. Drag and drop the translation file into the folder
<br>

#### Create my translation :
3. Make a new file in JSON format : {fileExtention}.json

    ##### Example:
    "***testCode***.json" are selected when the current file format is "####.***testCode***"
<br>
4. Copy paste the next json pattern and define your translation table :

```JSON
{
    "name":"{{FormatExtension}}",
    "translation":{
        "{{OutputFormatName}}":{
            "outputExtension":"{{OutputExtension}}",
            "table":{
                "{{InstructionName}}":["{{REGEX WITH SELECTION GROUP}}","{{TRANSLATED CODE WITH %{{groupNumber}} }}"]
            }
        }
    }
}
```

##### Exemple :

```JSON
{
    "name":"isc0",
    "translation":{
        "nasm_x86_x64":{
            "outputExtension":"nasm",
            "table":{
                "emptyLine":["^\n*$",""],                                                   //Empty line
                "architectureMode":["mode[ ]+([0-9]{1,3})","[BITS %1]"],                    //mode 64   TO  [BITS 64]
                "assign":["([a-zA-Z0-9]+)[ ]{0,}(=)[ ]{0,}([\\S]{1}.{0,})","mov %1,%3"]     //a=5       TO  mov a,5
            }
        }
    }
}
```